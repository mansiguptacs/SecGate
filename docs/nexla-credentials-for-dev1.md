# Nexla credentials for Dev 1 (Laptop B)

Received from Nexla booth: **2026-07-17 ~2:07 PM PDT**

> **Security:** Live service keys were previously committed in this file. Treat them as **compromised** — rotate with Nexla and put the new key only in local `.env` (gitignored). Do not paste production keys into git.

## Set on Laptop B

Add to `.env` (never commit) before restarting the stack:

```bash
# Live path (only after a Nexset exists and key is rotated):
NEXLA_USE_SHIM=0
NEXLA_MCP_URL=https://api-genai.nexla.io/mcp/service_key/<server_key>
NEXLA_SERVICE_KEY=<rotated-nexla-service-key>
NEXLA_BUDGET_TOOL=get_team_budget
NEXLA_TEAM=platform-eng

# Safe demo fallback (recommended if live MCP fails or org has 0 Nexsets):
# NEXLA_USE_SHIM=1
```

Then restart: `npm run start:phase2`

Control Tower verdict bubbles should show **Nexla** badge (live) when shim is off; with shim on, badge still reads **Nexla**.

## Verify

```bash
# Quick MCP smoke test from Laptop B terminal (replace placeholders):
curl -s "https://api-genai.nexla.io/mcp/service_key/<server_key>" \
  -H "Authorization: Bearer <rotated-nexla-service-key>" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"get_team_budget","arguments":{"team":"platform-eng"}},"id":1}'
# Expect: { "team": "platform-eng", "monthly_budget_usd": 500, "spent_usd": 47 }
```

If the call fails (404, auth error), fall back: set `NEXLA_USE_SHIM=1` and restart —
the local shim still shows the **Nexla** badge and the demo is unaffected.
