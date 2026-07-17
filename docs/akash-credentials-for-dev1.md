# Akash credentials for Dev 1 (Laptop B)

Received: **2026-07-17 ~2:13 PM PDT** — from Akash Console account.

## Set on Laptop B

Add to `.env` or export before starting the stack:

```bash
BACKEND=akash
AKASH_API_KEY=ac.sk.production.144ef53c558a5e4dcde53f02e2e4627b521c847eca1108a642f8a1436ee02eb1
```

Then restart:

```bash
npm run start:phase2
# or equivalently:
BACKEND=akash node scripts/start-phase2.js
```

The startup script auto-reads `.env` — so just having these two lines in `.env` is enough.

## What this enables

With `AKASH_API_KEY` set:
- `apply_deployment` calls go to **live Akash Console API** (`console-api.akash.network`)
- Guardian creates a real lease, polls for bids, waits for a live ingress URL
- The deployment row in Control Tower shows a **real clickable HTTPS URL**

Without the key: `BACKEND=akash` runs in **dry-run** mode (fake lease IDs + fake URLs — still looks good but URL won't load in browser).

## Verify live path

```bash
# On Laptop B, after npm run start:phase2:
curl -s http://localhost:3200/plan_deployment \
  -H "authorization: Bearer dev-agent-token-PHASE2" \
  -H "content-type: application/json" \
  -d '{"name":"staging-api","gpu":"none","gpuCount":1}'
# Expect: { "proposalId": "prop-...", "estimated": ... }

# Then check Control Tower at http://localhost:3100/ — proposal should appear
```

## Nexla status (for reference)

- `NEXLA_USE_SHIM=1` on both Laptop A and B — correct for now.
- Org has 0 Nexsets; local shim starts automatically with `start:phase2`.
- Control Tower will show **Nexla** badge from the shim — looks identical to live.
- If Nexla studio gets a Nexset configured before 3:00 PM: set `NEXLA_USE_SHIM=0`,
  `NEXLA_MCP_URL=https://api-genai.nexla.io/mcp/service_key/<server_key>`,
  `NEXLA_SERVICE_KEY=2b34d31db2c741a8ac8bd7166dbe8d98`, restart.
