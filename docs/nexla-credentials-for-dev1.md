# Nexla credentials for Dev 1 (Laptop B)

Received from Nexla booth: **2026-07-17 ~2:07 PM PDT**

Run on **Laptop B** before restarting the stack:

```bash
export NEXLA_USE_SHIM=0
export NEXLA_MCP_URL=https://api-genai.nexla.io/mcp/service_key/2b34d31db2c741a8ac8bd7166dbe8d98
export NEXLA_SERVICE_KEY=2b34d31db2c741a8ac8bd7166dbe8d98
export NEXLA_BUDGET_TOOL=get_team_budget
export NEXLA_TEAM=platform-eng
```

Or add to Laptop B's `.env` file (same changes as Laptop A's `.env`).

Then restart: `npm run start:phase2`

Control Tower verdict bubbles should now show **Nexla** badge (live) instead of **local**.

## Verify

```bash
# Quick MCP smoke test from Laptop B terminal:
curl -s https://api-genai.nexla.io/mcp/service_key/2b34d31db2c741a8ac8bd7166dbe8d98 \
  -H "Authorization: Bearer 2b34d31db2c741a8ac8bd7166dbe8d98" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"get_team_budget","arguments":{"team":"platform-eng"}},"id":1}'
# Expect: { "team": "platform-eng", "monthly_budget_usd": 500, "spent_usd": 47 }
```

If the call fails (404, auth error), fall back: set `NEXLA_USE_SHIM=1` and restart —
the local shim still shows the **Nexla** badge and the demo is unaffected.
