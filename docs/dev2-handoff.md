# Developer 2 handoff (Phase 2)

Laptop A connects through the **Pomerium policy shim** (identity-aware gateway) on Laptop B. Real Pomerium Docker + IdP can replace the shim later — config lives under `pomerium/` as PPL-shaped YAML.

## What you need from Dev 1

| Item | Status | Value |
|------|--------|-------|
| Gateway base URL (**LIVE tunnel**) | **Ready** | `http://172.24.82.134:3200` |
| Public tunnel URL | **Backup only** | See `data/tunnel-url.txt` after `npm run start:stable` |
| MCP transport | Ready | HTTP JSON tool routes (streamable-HTTP when real Pomerium MCP lands) |
| Dev identity | Ready | `dev@secgate.local` |
| **Dev bearer token** | Ready | `dev-agent-token-PHASE2` |
| Guardian identity | Ready | `guardian@secgate.local` / `guardian-agent-token-PHASE2` |
| Control Tower (Laptop B) | Ready | `http://localhost:3100/` on Laptop B |

## Tokens (Phase 2)

```
Authorization: Bearer dev-agent-token-PHASE2      # Laptop A / developer agent
Authorization: Bearer guardian-agent-token-PHASE2 # guardian only (do NOT put on Laptop A)
```

| Identity | Can call | Cannot call |
|----------|----------|-------------|
| `dev-agent` | `plan_deployment`, `estimate_cost`, `list_deployments` | `apply_deployment`, `destroy_deployment` → **403** |
| `guardian` | all tools | — |
| quarantined `dev-agent` | nothing | even `plan_*` → **403** |

## Connectivity (Laptop B — LAN first)

| Endpoint | URL | Who uses it |
|----------|-----|-------------|
| **Gateway (MCP) LIVE tunnel** `:3200` | `http://172.24.82.134:3200` | **Laptop A** — Cursor MCP |
| Gateway stable tunnel backup | `data/tunnel-url.txt` (after `npm run start:stable`) | Only if Wi‑Fi client isolation blocks LAN |
| Control Tower (local) | `http://localhost:3100/` | **Laptop B** operator |

**Do not** treat Cloudflare quick tunnels (`*.trycloudflare.com`) as the primary path — they die and rotate hostnames. Prefer LAN; use `npm run start:stable` for a fixed localtunnel/named backup.

**Dev bearer token (Laptop A only):** `dev-agent-token-PHASE2`

```bash
# Header on every MCP/tool call from Laptop A
Authorization: Bearer dev-agent-token-PHASE2
```

Do **not** put `guardian-agent-token-PHASE2` on Laptop A.

Quick Cursor MCP paste: see [`docs/cursor-mcp.json`](./cursor-mcp.json) and [`docs/laptop-a-cheatsheet.md`](./laptop-a-cheatsheet.md).

---

## How Laptop B exposes the gateway

```bash
# Preferred one-shot: ensure phase2 + print LAN + start stable tunnel backup
npm run start:stable
# or: bash scripts/start-stable-gateway.sh
```

### Option A — same Wi‑Fi LAN (**default**)

```text
http://<Laptop-B-IP>:3200
```

Find IP: `ipconfig getifaddr en0` (macOS). Gateway binds `0.0.0.0:3200`.

Venue guest Wi‑Fi sometimes blocks client-to-client — only then use a tunnel below.

### Option B — stable tunnel backup (`start-stable-gateway.sh`)

Priority inside the script:

1. Named Cloudflare tunnel (`SECGATE_CF_TUNNEL_TOKEN` / `SECGATE_CF_TUNNEL_NAME`)
2. ngrok reserved domain (`SECGATE_NGROK_DOMAIN`)
3. `ssh -R` (`SECGATE_SSH_TUNNEL_HOST` + optional `SECGATE_SSH_TUNNEL_URL`)
4. `npx localtunnel --port 3200 --subdomain secgate-hack` (or saved `data/tunnel-subdomain.txt`)

URL is written to **`data/tunnel-url.txt`** (gitignored).

### Option C — Pomerium `pom.run` (if you have it)

```bash
pomerium run --from https://secgate.localhost.pomerium.io --to http://127.0.0.1:3200
# or reverse tunnel:
ssh -R 0:127.0.0.1:3200 ssh.pom.run
```

### Option D — Cloudflare / ngrok quick tunnels (**last resort**)

```bash
npm run tunnel:gateway          # resilient keep-alive loop; prints URL to .secgate-logs/gateway-tunnel-url.txt
# or: cloudflared tunnel --url http://127.0.0.1:3200
# or: ngrok http 3200
```

## Cursor / Claude Code MCP config

```json
{
  "mcpServers": {
    "secgate": {
      "url": "http://172.24.82.134:3200",
      "transport": "streamable-http",
      "headers": {
        "Authorization": "Bearer dev-agent-token-PHASE2"
      }
    }
  }
}
```

If LAN is blocked, replace `url` with the HTTPS value from Laptop B’s `data/tunnel-url.txt`.

**Note:** Phase 2 currently exposes **HTTP JSON tool routes** (same paths as Phase 1: `/plan_deployment`, etc.) behind the policy shim — not full MCP streamable-HTTP yet. Until real Pomerium MCP is swapped in, Laptop A can:

1. Use curl / a thin agent driver against the tunnel URL with the bearer token, **or**
2. Point a custom MCP bridge at those HTTP routes.

Example smoke (from Laptop A):

```bash
export SECGATE=http://172.24.82.134:3200   # or backup from data/tunnel-url.txt
export TOK=dev-agent-token-PHASE2

curl -s "$SECGATE/plan_deployment" \
  -H "authorization: Bearer $TOK" -H "content-type: application/json" \
  -d '{"name":"staging-api","gpu":"none","gpuCount":1}'

# Expect 403:
curl -s -o /dev/null -w '%{http_code}\n' "$SECGATE/apply_deployment" \
  -H "authorization: Bearer $TOK" -H "content-type: application/json" \
  -d '{"proposalId":"prop-anything"}'
```

## Smoke test once connected

1. `plan_deployment` succeeds as dev → appears on Laptop B Control Tower as **ALLOW**
2. `apply_deployment` as dev → **403 BLOCKED** on Control Tower
3. After ~3 blocked applies, guardian quarantines → even `plan_deployment` → **403**

## Laptop B (Dev 1) quick start

```bash
npm install && npm run build
npm run test:phase1 && npm run test:phase2 && npm run test:phase3 && npm run test:phase4
npm run start:phase2
# Control Tower :3100 · Gateway :3200 · BACKEND=mock by default

# Phase 3 Akash path (dry-run without key; live with AKASH_API_KEY):
# BACKEND=akash npm run start:phase3
```

## Akash credentials to hand Dev 1

See **[docs/akash-backend.md](./akash-backend.md)** for the full table. Minimum for a **live** lease URL on camera:

| Var | Where |
|-----|--------|
| `AKASH_API_KEY` | console.akash.network → Settings → API Keys |
| `BACKEND=akash` | set on Laptop B before `start:phase3` |

Without the key, `BACKEND=akash` still demos with dry-run URLs.

## Zero.xyz + Nexla (Phase 4)

Full guide: **[docs/phase4-sponsors.md](./phase4-sponsors.md)**.

| Sponsor | Required on Laptop B | Fallback if missing |
|---------|----------------------|---------------------|
| **Zero.xyz** | `npm i -g @zeroxyz/cli && zero init && zero auth login` → `~/.zero` | Static GPU price table |
| **Nexla** | `NEXLA_MCP_URL` + `NEXLA_SERVICE_KEY` (tool `get_team_budget`) | Local MCP shim on `:3300` (still **Nexla** badge) or `data/budget.json` |

```bash
# Demo (default): local Nexla-compatible shim — npm run start:phase2 starts it
export NEXLA_USE_SHIM=1
export NEXLA_MCP_URL="http://127.0.0.1:3300/mcp"
export NEXLA_SERVICE_KEY="nxl_sk_secgate_demo_shim"

# Booth / real ToolSet MCP when ready:
# export NEXLA_USE_SHIM=0
# export NEXLA_MCP_URL="https://api-genai.nexla.io/mcp/service_key/<server_key>"
# export NEXLA_SERVICE_KEY="nxl_sk_...."
# then: npm run start:phase2
```

Control Tower chat bubbles show **Zero/table** and **Nexla/local** source badges on guardian verdicts.

## Sponsor onboarding (unchanged)

1. **Akash** — Console + credits; hand **`AKASH_API_KEY`** (Console API key) to Dev 1  
2. **Zero.xyz** — auth on **Laptop B** (`zero init` / `zero auth login`)  
3. **Nexla** — budget ToolSet MCP URL + key (or keep local JSON)

## Sync points

- **2:15** — Phase 2 gateway up; connect Laptop A via tunnel  
- **3:30** — full rehearsal  
- **3:50** — record + Devpost submit  
