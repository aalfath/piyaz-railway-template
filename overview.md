# Deploy and Host Piyaz on Railway

Piyaz is an open-source agentic workspace where people and coding agents plan and build the same project. It keeps a project as a graph of tasks, each linked to what blocks it, with decisions, notes and execution history attached. Agents in Claude Code, Codex, Cursor and similar tools reach it as a remote MCP server; people use the web app.

## About Hosting Piyaz

This template builds Piyaz v0.4.18 from its tagged source and runs it next to Railway PostgreSQL. On first boot the start script creates Piyaz's database roles and auth schema, runs the migrations, applies the row-level security policies, and registers the MCP endpoint for OAuth. It then creates your owner account from `PIYAZ_ADMIN_EMAIL` and a generated password before the public port opens. Sign-up is invite-only: only an address with a pending team invitation can register. All data lives in PostgreSQL on its volume, so redeploys and restarts keep it. Updates arrive as Railway update notices from the template's GitHub repo.

## Common Use Cases

* Give several coding agents (Claude Code, Codex, Cursor) one shared task graph through MCP
* Break a feature or a new codebase into small tasks with dependencies, decisions and acceptance criteria
* Keep project notes and an activity history that every agent session and teammate can read

## Dependencies for Piyaz Hosting

* PostgreSQL (Railway's PostgreSQL service, included)
* A public Railway domain (generated on deploy)

### Deployment Dependencies

* Piyaz source and releases: https://github.com/FrkAk/piyaz
* Piyaz documentation: https://docs.piyaz.ai
* Template repository: https://github.com/aalfath/piyaz-railway-template

### Implementation Details

Services:

* **Piyaz**: the web app and MCP server, built from the template repo. Health check `/api/auth/jwks`.
* **Postgres**: Railway PostgreSQL with a volume. It holds every project, task, note and account.

After deploy:

1. Open the Piyaz service's **Variables** tab and copy `PIYAZ_ADMIN_PASSWORD`. Sign in at your Railway URL with `PIYAZ_ADMIN_EMAIL` and that password, then change it under Settings.
2. Create your team. To add people, invite their email under Settings and share the team's invite code: this server sends no email, and only invited addresses can sign up.
3. Connect your agent to `https://YOUR-DOMAIN/api/mcp` (OAuth sign-in opens in your browser):

```
claude mcp add -s user --transport http piyaz https://YOUR-DOMAIN/api/mcp
codex mcp add piyaz --url https://YOUR-DOMAIN/api/mcp
```

Cursor (`~/.cursor/mcp.json`): `{"mcpServers": {"piyaz": {"url": "https://YOUR-DOMAIN/api/mcp"}}}`

Notes:

* Runs on Railway's Free plan limits (0.5 GB RAM per service); Piyaz used about 200 MB in our tests.
* Email (password reset, verification) is off because no mail transport is set up. Set `PIYAZ_OPEN_SIGNUP=true` only if you want anyone to be able to register.
* `PIYAZ_ADMIN_EMAIL` and `PIYAZ_ADMIN_PASSWORD` are used only on the first boot. Later changes to them have no effect.
* Updates: when the template repo moves to a new Piyaz release, Railway shows an update notice on your service. Read the repo's CHANGELOG before you apply it; migrations run on start.

## Why Deploy Piyaz on Railway?

<!-- Recommended: Keep this section as shown below -->
Railway is a singular platform to deploy your infrastructure stack. Railway will host your infrastructure so you don't have to deal with configuration, while allowing you to vertically and horizontally scale it.

By deploying Piyaz on Railway, you are one step closer to supporting a complete full-stack application with minimal burden. Host your servers, databases, AI agents, and more on Railway.
<!-- End recommended section -->
