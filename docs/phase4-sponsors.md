# Phase 4 — Zero.xyz pricing + Nexla budgets

AgentFence’s guardian enriches cost decisions with **live pricing** (Zero.xyz) and **team budget/spend** (Nexla MCP). Both have offline fallbacks so the demo never depends on sponsor auth.

## Defaults (offline — always work)

| Concern | Fallback | Where |
|---------|----------|--------|
| GPU / cloud rates | Static table (`shared` `GPU_PRICING`) | 8×A100 ≈ **$12,400/mo** |
| Team budget | `data/budget.json` | `$500/mo` cap, `spent_usd` |

No Zero CLI and no Nexla env → estimates + guardian reject/approve behave exactly as Phase 1–3.

## Enable Zero.xyz (Laptop B)

```bash
npm i -g @zeroxyz/cli
zero init
zero auth login          # writes ~/.zero
# smoke:
zero search "cloud GPU A100 pricing"
```

Guardian detects `~/.zero` (and `zero` on PATH or `~/.zero/runtime/bin/zero`). On each pending proposal it runs `zero search …` with a **3s timeout**, parses a `$/hr` figure, caches ~5 min, then evaluates budget. Timeout / parse miss → **table**.

| Variable | Purpose |
|----------|---------|
| `ZERO_TIMEOUT_MS` | Max wait (default `3000`) |
| `ZERO_CACHE_TTL_MS` | Cache TTL (default `300000`) |
| `ZERO_BIN` | Override CLI path |
| `ZERO_FORCE_OFF=1` | Force table (tests / offline demos) |
| `ZERO_FORCE_ON=1` | Treat Zero as ready (needs working `runZeroSearch` / CLI) |

Control Tower chat bubbles show a **Zero** vs **table** badge on guardian verdicts.

## Enable Nexla

Expected tool (override with env): **`get_team_budget`** returning JSON like:

```json
{
  "team": "platform-eng",
  "monthly_budget_usd": 500,
  "spent_usd": 42
}
```

### Demo default — local MCP shim (Control Tower **Nexla** badge)

Real Nexla ToolSet credentials usually come from the sponsor booth / MCP Studio early access. Until then, AgentFence ships a **Nexla-compatible local MCP shim** (`nexla/`):

```bash
# Wired automatically by npm run start:phase2 when URL is localhost / unset
export NEXLA_USE_SHIM=1
export NEXLA_MCP_URL="http://127.0.0.1:3300/mcp"
export NEXLA_SERVICE_KEY="nxl_sk_secgate_demo_shim"
export NEXLA_BUDGET_TOOL="get_team_budget"
```

Shim reads the same `data/budget.json` fields but answers via JSON-RPC `tools/call`, so guardian sets `budgetSource: "nexla"` and Control Tower shows the **Nexla** badge. Clearly labeled: *demo stand-in — swap for real ToolSet MCP when booth key ready*.

```bash
npm run start:nexla          # shim alone on :3300
npm run test:nexla
```

### Real Nexla (booth / MCP Studio)

1. Get org access (booth, [early access](https://nexla.com/early-access/), or [dataops.nexla.io](https://dataops.nexla.io) trial).
2. Settings → Authentication → **Create Service Key** (`nxl_sk_…`).
3. Deploy a ToolSet as MCP server with tool **`get_team_budget`** (fields above).
4. Copy the export URL: `https://api-genai.nexla.io/mcp/service_key/<server_key>`.
5. Paste into `.env` (gitignored) and disable the shim:

```bash
export NEXLA_USE_SHIM=0
export NEXLA_MCP_URL="https://api-genai.nexla.io/mcp/service_key/<server_key>"
export NEXLA_SERVICE_KEY="nxl_sk_...."   # or NEXLA_API_KEY
# optional:
export NEXLA_BUDGET_TOOL="get_team_budget"
export NEXLA_TIMEOUT_MS=3000
export NEXLA_TEAM="platform-eng"
```

Guardian POSTs MCP JSON-RPC `tools/call` with `Accept: application/json`. Missing URL/key, HTTP error, or timeout → **`data/budget.json`** (`local` badge).

Chat bubbles show **Nexla** vs **local** on the budget badge.

## Local budget file

```json
{
  "team": "platform-eng",
  "monthly_budget_usd": 500,
  "spent_usd": 0
}
```

Override path with `SECGATE_BUDGET_FILE` or put the file under `SECGATE_DATA_DIR`.

## Tests

```bash
npm run test:phase1
npm run test:phase2
npm run test:phase3
npm run test:phase4
```

Phase 4 covers: offline table/local, mocked Zero prices, mocked Nexla budgets, timeout→fallback, 8×A100 reject.

## Gaps

- Zero search results vary; parser picks the $/hr closest to the static table for that GPU — not a full marketplace quote.
- Nexla tool name/schema must match (or set `NEXLA_BUDGET_TOOL`).
- Estimate HTTP tool still seeds from the **table**; guardian re-prices before decide when Zero is live (demo-visible on verdict bubbles).
- Fillmore skipped; full Pomerium OAuth still optional (shim tokens remain).
