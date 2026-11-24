# Changelog

## 0.4.18 (2026-11-24)

- First template version: Piyaz v0.4.18 (commit `e1ed033`) built on `oven/bun:1.4.5`, with Railway PostgreSQL.
- First-boot owner account from `PIYAZ_ADMIN_EMAIL` and a generated password; invite-only sign-up.
- Idempotent database bootstrap (roles, migrations, RLS policies, OAuth resources) under an advisory lock.
