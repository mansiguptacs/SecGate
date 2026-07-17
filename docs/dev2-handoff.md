# Developer 2 handoff (Phase 2)

Laptop A connects through the **Pomerium policy shim** (identity-aware gateway) on Laptop B. Real Pomerium Docker + IdP can replace the shim later — config lives under `pomerium/` as PPL-shaped YAML.

## What you need from Dev 1

| Item | Status | Value |
|------|--------|-------|
| Gateway base URL (local) | **Ready** | `http://<Laptop-B-LAN-IP>:3200` or tunnel URL below |
| Public tunnel URL | **LIVE** | `https://delays-era-replace-lightning.trycloudflare.com` |
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

## Live tunnels (Laptop B — updated Jul 17 2026)

| Endpoint | URL | Who uses it |
|----------|-----|-------------|
| **Gateway (MCP)** `:3200` | `https://delays-era-replace-lightning.trycloudflare.com` | **Laptop A** — Cursor MCP |
| Control Tower / budget `:3100` | `https://draft-sao-cpu-deeper.trycloudflare.com` | Optional remote budget/dashboard |
| Control Tower (local) | `http://localhost:3100/` | **Laptop B** operator |

**Dev bearer token (Laptop A only):** `dev-agent-token-PHASE2`

```bash
# Header on every MCP/tool call from Laptop A
Authorization: Bearer dev-agent-token-PHASE2
```

Do **not** put `guardian-agent-token-PHASE2` on Laptop A.

Quick Cursor MCP paste: see [`docs/cursor-mcp.json`](./cursor-mcp.json) and [`docs/laptop-a-cheatsheet.md`](./laptop-a-cheatsheet.md).

---

## Public tunnel (pick one)

Run **on Laptop B** after `npm run start:phase2` (gateway listens on **:3200**).

### Option A — Pomerium `pom.run` (preferred if you have it)

```bash
# From Pomerium CLI (if installed)
pomerium run --from https://secgate.localhost.pomerium.io --to http://127.0.0.1:3200
# or reverse tunnel:
ssh -R 0:127.0.0.1:3200 ssh.pom.run
```

Copy the printed HTTPS URL → that is Laptop A's MCP base URL.

### Option B — Cloudflare Tunnel (pragmatic fallback)

```bash
brew install cloudflared   # once
cloudflared tunnel --url http://127.0.0.1:3200
```

Use the `https://*.trycloudflare.com` URL.

### Option C — ngrok

```bash
ngrok http 3200
```

Use the `https://…ngrok…` forwarding URL.

### Option D — same Wi‑Fi LAN (venue-dependent)

```text
http://<Laptop-B-IP>:3200
```

Find IP: `ipconfig getifaddr en0` (macOS). Venue guest Wi‑Fi often blocks client-to-client — prefer A/B/C.

## Cursor / Claude Code MCP config

```json
{
  "mcpServers": {
    "secgate": {
      "url": "https://REPLACE_WITH_TUNNEL_URL",
      "transport": "streamable-http",
      "headers": {
        "Authorization": "Bearer dev-agent-token-PHASE2"
      }
    }
  }
}
```

**Note:** Phase 2 currently exposes **HTTP JSON tool routes** (same paths as Phase 1: `/plan_deployment`, etc.) behind the policy shim — not full MCP streamable-HTTP yet. Until real Pomerium MCP is swapped in, Laptop A can:

1. Use curl / a thin agent driver against the tunnel URL with the bearer token, **or**
2. Point a custom MCP bridge at those HTTP routes.

Example smoke (from Laptop A):

```bash
export SECGATE=https://REPLACE_WITH_TUNNEL_URL
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
