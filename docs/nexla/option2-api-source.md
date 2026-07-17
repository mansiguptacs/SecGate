# Nexla Option 2 — REST API source (skip Studio file-upload SOP)

When MCP Studio file upload only offers DB / Airtable / Sheets connectors, point Nexla at AgentFence’s public budget HTTP API instead.

## What AgentFence exposes

With phase2 (or infra-mcp) running on port `3100`:

| URL | Response |
|-----|----------|
| `GET /budget?team=platform-eng` | `{ "team", "monthly_budget_usd", "spent_usd" }` |
| `GET /budget` | `{ "teams": [...], "count": N }` |

Seed data lives in `docs/nexla/team-budgets.json` (same rows as the CSV).

## 1. Start budget API + public tunnel (Laptop B)

```bash
# terminal A — full stack (or just infra-mcp)
npm run start:phase2
# or: npm run start -w infra-mcp

# terminal B — temporary public HTTPS URL (cloudflared is installed)
npm run tunnel:budget
# → copy the https://….trycloudflare.com URL it prints
```

**Public tunnel:** run this yourself in a **dedicated Terminal.app tab** (not via Cursor agents — stack restarts keep aborting those jobs):

```bash
# ensure API is up
curl -sS 'http://127.0.0.1:3100/budget?team=platform-eng'
npm run tunnel:budget
# copy the printed https://….trycloudflare.com URL into Nexla Studio
```

If Nexla gets **HTTP 530** (or DNS fails), the quick tunnel died or rotated — kill stale `cloudflared`, run `npm run tunnel:budget` again, and paste the **new** `*.trycloudflare.com` URL into Studio (do not reuse an old hostname).

**Stable fallback (if quick tunnels keep dying):** host a tiny HTTPS app that answers `GET /budget?team=…` (e.g. Vercel/Railway serverless). A raw gist/static file cannot honor query params the way AgentFence’s `/budget` does.

Verify locally first:

```bash
curl -sS 'http://127.0.0.1:3100/budget?team=platform-eng'
# {"team":"platform-eng","monthly_budget_usd":500,"spent_usd":47}
```

## 2. In Nexla Studio (or classic Data Ops)

1. Create a **REST / API** data source (not file upload).
2. Base URL = the cloudflared URL from step 1 (no trailing slash).
3. Path / endpoint = `/budget?team=platform-eng` (or `/budget` for the full table).
4. Method = `GET`, no auth.
5. Activate → wait for a Nexset to appear.
6. Create ToolSet from that Nexset (Studio UI, or GenAI API `POST /v1/toolsets:from_nexsets` with `create_export: true`).
7. Export MCP → copy `https://api-genai.nexla.io/mcp/service_key/<server_key>`.

## 3. Hand to Dev 1 / `.env`

```bash
NEXLA_USE_SHIM=0
NEXLA_MCP_URL=https://api-genai.nexla.io/mcp/service_key/<server_key>
NEXLA_SERVICE_KEY=<GenAI service key — same key already in .env is fine if org-scoped>
NEXLA_BUDGET_TOOL=get_team_budget   # Studio may export nexset_read_team_budget — set to tools/list name
NEXLA_TEAM=platform-eng
```

Keep the cloudflared tunnel **up** while Nexla ingests / refreshes the source. After the Nexset is materialised you can drop the tunnel for a static snapshot; for live demos leave it running.

### Live MCP note (2026-07-17)

After ToolSet export, `tools/list` may expose **`nexset_read_team_budget`** / **`nexset_read_team_budgets`** (not `get_team_budget`). Set `NEXLA_BUDGET_TOOL` to the exact name from Studio. Guardian parses Nexla `dataframe_columns` ToolResult payloads into `{ team, monthlyBudgetUsd, spentUsd, source: "nexla" }`. MCP URL comes from Studio export — put it only in local `.env` (`NEXLA_USE_SHIM=0`).

## Why not CLI-only?

- **`nexla-cli` exists** (PyPI: `nexla-cli`) and wraps sources / toolsets / MCP attach.
- GenAI key (`api-genai.nexla.io`) **can** `GET/POST /v1/toolsets` and `POST /v1/toolsets:from_nexsets`, but **cannot** `POST /v1/tools` directly — tools are created only **from a Nexset**.
- Creating that Nexset still needs a classic data source (API / Sheets / Airtable / file). Option 2 is the fastest way to get a Nexset without fighting Studio’s file-upload tool limits.

## Fallback (demo still works)

If Studio stalls past ~3:00 PM: leave `NEXLA_USE_SHIM=1` (local MCP on `:3300`). Control Tower already shows the **Nexla** badge. Screenshot Studio for Devpost.
