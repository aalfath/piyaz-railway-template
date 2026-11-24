import { APIError } from "better-auth/api";
import { sql } from "drizzle-orm";
import { timingSafeEqual } from "node:crypto";
import { authDb } from "@/lib/db/connection";

/**
 * Railway template addition: invite-only sign-up.
 *
 * Upstream self-host builds leave sign-up open to anyone who finds the URL.
 * Here an account can be created only when
 *   1. the start script's one-time bootstrap token is presented while the
 *      database has no users (this creates the owner from PIYAZ_ADMIN_EMAIL), or
 *   2. the email has a pending, unexpired team invitation, or
 *   3. the deployer set PIYAZ_OPEN_SIGNUP=true.
 */
export async function assertSelfHostSignupAllowed(
  email: string,
  headers: Headers | undefined,
): Promise<void> {
  if (process.env.PIYAZ_OPEN_SIGNUP === "true") return;

  const expected = process.env.PIYAZ_BOOTSTRAP_TOKEN ?? "";
  const given = headers?.get("x-piyaz-bootstrap") ?? "";
  const tokenOk =
    expected.length >= 32 &&
    given.length === expected.length &&
    timingSafeEqual(Buffer.from(given), Buffer.from(expected));

  const rows = (await authDb.execute(sql`
    SELECT
      (SELECT count(*) FROM piyaz_auth."user")::int AS users,
      (SELECT count(*) FROM piyaz_auth.invitation
        WHERE lower(email) = lower(${email})
          AND status = 'pending'
          AND "expiresAt" > now())::int AS invites
  `)) as unknown as Array<{ users: number; invites: number }>;
  const { users, invites } = rows[0] ?? { users: 0, invites: 0 };

  if (tokenOk && users === 0) return;
  if (invites > 0) return;

  throw new APIError("FORBIDDEN", {
    message:
      "Sign-up on this Piyaz server is invite-only. Ask a team admin to invite this email address first.",
    code: "SIGNUP_INVITE_ONLY",
  });
}
