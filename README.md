[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/new/template/piyaz?utm_medium=integration&utm_source=button&utm_campaign=piyaz)

# Piyaz on Railway

One-click Railway template for [Piyaz](https://github.com/FrkAk/piyaz) **v0.4.18**, the open-source (AGPL-3.0) agentic workspace where people and coding agents plan and build the same project. It runs as a web app and a remote MCP server (OAuth 2.1) at `https://YOUR-DOMAIN/api/mcp`.

## What it deploys

| Service | Source | Role |
| --- | --- | --- |
| **Piyaz** | this repo (`Dockerfile`) | Web app and MCP server on `$PORT`, health check `/api/auth/jwks` |
| **Postgres** | Railway PostgreSQL | All data (accounts, projects, tasks, notes) on a volume |

Upstream publishes no container image, so the `Dockerfile` downloads the source of tag `v0.4.18` (commit `e1ed033e9a4d0e7af81da5833b47dcd2c0e6fdfb`, tarball SHA-256 checked) and builds it on `oven/bun:1.4.5@sha256:3aa040e5445efa09d75bb428a64ba50db13e2b3ac9b6b0c7f145615f62b2ee18`.

## What the start script does

1. Creates Piyaz's database roles (`app_user`, `service_role`, `auth_role`; passwords derived from `BETTER_AUTH_SECRET`), the `piyaz_auth` schema, runs the Drizzle migrations, applies the grants and row-level security policies, and registers the OAuth resources for your domain. All steps are idempotent and run under a Postgres advisory lock.
2. On the first boot only, starts Piyaz on loopback and creates the owner account from `PIYAZ_ADMIN_EMAIL` / `PIYAZ_ADMIN_PASSWORD`. If that fails the service stops instead of opening the public port.
3. Starts Piyaz on `0.0.0.0:$PORT`, and exits non-zero if it stops unexpectedly so Railway restarts it.

**Invite-only sign-up** (`selfhost/signup-gate.ts`, added by `selfhost/apply-patches.ts`): upstream self-host builds let anyone sign up. Here only an email with a pending team invitation can register. Set `PIYAZ_OPEN_SIGNUP=true` to allow open sign-up.

## Variables

| Variable | Default | Notes |
| --- | --- | --- |
| `PIYAZ_ADMIN_EMAIL` | *(you enter it)* | Owner account email, used on first boot |
| `PIYAZ_ADMIN_PASSWORD` | `${{secret(24)}}` | Owner password, used on first boot; change it in Settings after signing in |
| `BETTER_AUTH_SECRET` | `${{secret(48)}}` | Session signing key; also seeds the DB role passwords |
| `BETTER_AUTH_URL` | `https://${{RAILWAY_PUBLIC_DOMAIN}}` | Public origin, used for OAuth and MCP |
| `PIYAZ_DATABASE_ADMIN_URL` | `${{Postgres.DATABASE_URL}}` | Superuser URL for the bootstrap only; removed from the app's environment before it starts |
| `TRUSTED_PROXY_HEADER` | `x-real-ip` | Railway's edge sets it to the real client IP |
| `PORT` | `3000` | |

## After deploy

Sign in with `PIYAZ_ADMIN_EMAIL` and the generated `PIYAZ_ADMIN_PASSWORD` (Piyaz service, Variables tab), create a team, then connect your agent:

```
claude mcp add -s user --transport http piyaz https://YOUR-DOMAIN/api/mcp
codex mcp add piyaz --url https://YOUR-DOMAIN/api/mcp
```

The server sends no email, so invite people under Settings and share the team invite code with them.

## Resources

Tested at 0.5 GB RAM / 1 vCPU per service (Railway Free plan): Piyaz used about 140-200 MB.

## Updates

Pushes to `main` of this repo raise an "update available" notice on every deployed copy; you choose when to apply it. Read [CHANGELOG.md](CHANGELOG.md) first. Migrations run automatically on start.
