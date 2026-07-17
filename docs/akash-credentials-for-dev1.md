# Akash credentials for Dev 1 (Laptop B)

Received: **2026-07-17 ~2:13 PM PDT** — from Akash Console account.

> **Security:** Live keys were previously committed in this file. Treat them as **compromised** — rotate in Akash Console and put the new key only in local `.env` (gitignored). Do not paste production keys into git.

## Set on Laptop B

Add to `.env` (never commit) or export before starting the stack:

```bash
BACKEND=akash
AKASH_API_KEY=<paste-rotated-akash-console-api-key>
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

- Prefer `NEXLA_USE_SHIM=1` until a Nexset exists (org had 0 at handoff).
- Local shim starts automatically with `start:phase2`.
- Control Tower will show **Nexla** badge from the shim — looks identical to live.
- If Nexla studio gets a Nexset configured: set `NEXLA_USE_SHIM=0`,
  `NEXLA_MCP_URL=https://api-genai.nexla.io/mcp/service_key/<server_key>`,
  `NEXLA_SERVICE_KEY=<rotated-nexla-service-key>` in `.env` only, then restart.
