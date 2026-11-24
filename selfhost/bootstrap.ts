// Railway template bootstrap for Piyaz. Two modes:
//   bun bootstrap.js db     -> roles, auth schema, migrations, RLS, OAuth resources;
//                              writes the role connection strings to $PIYAZ_ENV_FILE
//   bun bootstrap.js owner  -> creates the owner account through the app's own
//                              sign-up endpoint on the loopback-only instance
// Every step is idempotent and runs under a Postgres advisory lock, so
// overlapping Railway deploys can't migrate twice.
import { createHmac } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const SQL_DIR = process.env.PIYAZ_SQL_DIR ?? "/opt/piyaz/sql";
const MIGRATIONS_DIR = process.env.PIYAZ_MIGRATIONS_DIR ?? "/opt/piyaz/drizzle";
const LOCK_KEY = 314_900_149;

function fail(msg: string): never {
  console.error(`[piyaz-bootstrap] ERROR: ${msg}`);
  process.exit(1);
}
const log = (msg: string) => console.log(`[piyaz-bootstrap] ${msg}`);

function superUrl(): URL {
  const raw = process.env.PIYAZ_DATABASE_ADMIN_URL ?? "";
  if (!raw) fail("PIYAZ_DATABASE_ADMIN_URL is empty (expected ${{Postgres.DATABASE_URL}}).");
  try {
    return new URL(raw);
  } catch {
    fail("PIYAZ_DATABASE_ADMIN_URL is not a valid postgres:// URL.");
  }
}

function rolePassword(role: string): string {
  const secret = process.env.BETTER_AUTH_SECRET ?? "";
  if (secret.length < 32) fail("BETTER_AUTH_SECRET must be at least 32 characters.");
  // hex only: no quotes or backslashes, safe inside SQL literals and URLs
  return createHmac("sha256", secret).update(`piyaz-railway-role:${role}`).digest("hex");
}

function roleUrl(base: URL, role: string): string {
  const u = new URL(base.toString());
  u.username = role;
  u.password = rolePassword(role);
  return u.toString();
}

function readSql(file: string): string {
  return readFileSync(join(SQL_DIR, file), "utf8");
}

function splitPolicies(content: string): string[] {
  // Same handling as upstream tests/setup/migrate.ts.
  return content
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function waitForDb(url: string) {
  const deadline = Date.now() + 180_000;
  let lastErr = "";
  while (Date.now() < deadline) {
    const sql = postgres(url, { max: 1, connect_timeout: 5, onnotice: () => undefined });
    try {
      await sql`select 1`;
      await sql.end({ timeout: 2 });
      return;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
      await sql.end({ timeout: 1 }).catch(() => undefined);
      await Bun.sleep(2000);
    }
  }
  fail(`database not reachable after 180 s: ${lastErr}`);
}

async function withFreshConn<T>(url: string, fn: (sql: postgres.Sql) => Promise<T>) {
  const sql = postgres(url, { max: 1, onnotice: () => undefined });
  try {
    return await fn(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function dbMode() {
  const base = superUrl();
  const admin = base.toString();
  await waitForDb(admin);

  const lockConn = postgres(admin, { max: 1, onnotice: () => undefined });
  const deadline = Date.now() + 600_000;
  for (;;) {
    const [{ ok }] = await lockConn<{ ok: boolean }[]>`select pg_try_advisory_lock(${LOCK_KEY}) as ok`;
    if (ok) break;
    if (Date.now() > deadline) fail("another deploy held the bootstrap lock for 10 minutes");
    log("another deploy is migrating; waiting for the lock");
    await Bun.sleep(3000);
  }

  try {
    const [{ db }] = await lockConn<{ db: string }[]>`select current_database() as db`;
    const dbIdent = `"${db.replaceAll('"', '""')}"`;

    log("auth schema (init-auth.sql)");
    await withFreshConn(admin, (sql) => sql.unsafe(readSql("init-auth.sql")));

    log("roles and grants");
    await withFreshConn(admin, async (sql) => {
      const roles: Array<[string, string]> = [
        ["app_user", "NOBYPASSRLS"],
        ["service_role", "BYPASSRLS"],
        ["auth_role", "NOBYPASSRLS"],
      ];
      for (const [role, rls] of roles) {
        const pw = rolePassword(role);
        const [{ exists }] = await sql<{ exists: boolean }[]>`select exists(select 1 from pg_roles where rolname = ${role}) as exists`;
        if (!exists) await sql.unsafe(`CREATE ROLE ${role} LOGIN ${rls} PASSWORD '${pw}'`);
        // Re-assert every boot, so a rotated BETTER_AUTH_SECRET keeps working.
        await sql.unsafe(`ALTER ROLE ${role} LOGIN ${rls} NOSUPERUSER PASSWORD '${pw}'`);
      }
      await sql.unsafe(readSql("grants.sql"));
      await sql.unsafe(readSql("grants-auth.sql"));
      await sql.unsafe(`GRANT CREATE ON DATABASE ${dbIdent} TO service_role`);
      await sql.unsafe("CREATE SCHEMA IF NOT EXISTS drizzle");
      await sql.unsafe("GRANT USAGE, CREATE ON SCHEMA drizzle TO service_role");
      await sql.unsafe("ALTER DEFAULT PRIVILEGES IN SCHEMA drizzle GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role");
      await sql.unsafe(`REVOKE TEMPORARY ON DATABASE ${dbIdent} FROM PUBLIC`);
    });

    log("schema migrations (drizzle, as service_role)");
    const svc = postgres(roleUrl(base, "service_role"), { max: 1, onnotice: () => undefined });
    try {
      await migrate(drizzle(svc), {
        migrationsFolder: MIGRATIONS_DIR,
        migrationsSchema: "drizzle",
        migrationsTable: "__drizzle_migrations",
      });
    } finally {
      await svc.end({ timeout: 5 });
    }

    log("extensions, grants, RLS functions and policies, storage");
    for (const file of [
      "extensions.sql",
      "init-auth.sql",
      "grants.sql",
      "grants-auth.sql",
      "role-settings.sql",
      "rls-functions.sql",
    ]) {
      await withFreshConn(admin, (sql) => sql.unsafe(readSql(file)));
    }
    await withFreshConn(admin, async (sql) => {
      for (const stmt of splitPolicies(readSql("rls-policies.sql"))) await sql.unsafe(stmt);
    });
    await withFreshConn(admin, (sql) => sql.unsafe(readSql("storage.sql")));

    const origin = new URL(process.env.BETTER_AUTH_URL ?? "").origin;
    log(`OAuth resources for ${origin}`);
    await withFreshConn(admin, async (sql) => {
      for (const id of [origin, `${origin}/api/mcp`]) {
        await sql`INSERT INTO piyaz_auth."oauthResource" ("identifier", "name") VALUES (${id}, ${id}) ON CONFLICT ("identifier") DO NOTHING`;
      }
    });

    const [{ users }] = await lockConn<{ users: number }[]>`select count(*)::int as users from piyaz_auth."user"`;
    const envFile = process.env.PIYAZ_ENV_FILE ?? "/tmp/piyaz-db.env";
    writeFileSync(
      envFile,
      [
        `export DATABASE_URL='${roleUrl(base, "app_user")}'`,
        `export DATABASE_SERVICE_ROLE_URL='${roleUrl(base, "service_role")}'`,
        `export DATABASE_AUTH_URL='${roleUrl(base, "auth_role")}'`,
        `export PIYAZ_USER_COUNT=${users}`,
        "",
      ].join("\n"),
      { mode: 0o600 },
    );
    log(`database ready (${users} user account(s))`);
  } finally {
    await lockConn`select pg_advisory_unlock(${LOCK_KEY})`.catch(() => undefined);
    await lockConn.end({ timeout: 5 });
  }
}

async function ownerMode() {
  const email = (process.env.PIYAZ_ADMIN_EMAIL ?? "").trim();
  const password = process.env.PIYAZ_ADMIN_PASSWORD ?? "";
  const token = process.env.PIYAZ_BOOTSTRAP_TOKEN ?? "";
  const port = process.env.PIYAZ_BOOTSTRAP_PORT ?? "3999";
  if (!email.includes("@")) fail("PIYAZ_ADMIN_EMAIL must be an email address.");
  if (password.length < 8 || password.length > 128) fail("PIYAZ_ADMIN_PASSWORD must be 8-128 characters.");
  const origin = new URL(process.env.BETTER_AUTH_URL ?? "").origin;
  const res = await fetch(`http://127.0.0.1:${port}/api/auth/sign-up/email`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
      "x-piyaz-bootstrap": token,
    },
    body: JSON.stringify({
      email,
      password,
      name: process.env.PIYAZ_ADMIN_NAME?.trim() || "Owner",
      termsAccepted: true,
    }),
  });
  const body = await res.text();
  if (!res.ok) fail(`owner sign-up failed: HTTP ${res.status} ${body.slice(0, 300)}`);
  log(`owner account created for ${email}`);
}

const mode = process.argv[2];
if (mode === "db") await dbMode();
else if (mode === "owner") await ownerMode();
else fail("usage: bootstrap.js db|owner");
process.exit(0);
