# SecGate

**Agents propose. SecGate disposes.**

Zero-trust guardrail for infra agents: every infra change is cost-estimated and policy-approved before it lands. Built for the Loop Engineering Hackathon (July 17, 2026).

See [PLAN.md](./PLAN.md) for the full architecture and demo story.

## Phase 5 — Demo polish (Control Tower)

Scriptable 3-minute demo on one dark Control Tower screen. Keypress-driven scenes; tickets + ticket-driver as Laptop A fallback.

```bash
npm install && npm run build
npm run test:phase5
npm run start:phase2          # Terminal 1 — stack
# open http://localhost:3100/  (full-screen, zoom ~125%)
npm run demo                  # Terminal 2 — director (keys 0–4 / n / q)
```

| Scene | What fires |
|-------|------------|
| **0** Cold open | Gate OFF → 8×A100 disaster → spend ~**$12,400** red |
| **1** Happy path | Gate ON → clean ticket → approve → lease URL (~$3/mo) |
| **2** Attack | Poisoned → reject → apply **403**×3 → quarantine + PPL panel |
| **3** Orphan | Pre-seed idle untagged → guardian destroy → spend drops |
| **4** Close | Architecture / sponsor pause |

```bash
npm run demo -- --dry-run     # rehearse scene list without stack
npm run demo -- 1             # fire one scene
npm run demo -- --all         # 0→4 sequential
npm run agent:clean           # Laptop A fallback (gateway :3200)
npm run agent:poisoned
```

Tickets: [`tickets/clean.md`](./tickets/clean.md), [`tickets/poisoned.md`](./tickets/poisoned.md).

## Phase 4 status (Zero + Nexla)

Guardian enriches decisions with **Zero.xyz** pricing and **Nexla** budget/spend when configured. Offline defaults remain the static price table + `data/budget.json` ($500). Timeouts ≤3s → fallback. Control Tower shows **Zero/table** and **Nexla/local** badges on verdict chats.

```bash
npm run test:phase4
npm run test:nexla
# Zero:   zero init && zero auth login   (on Laptop B)
# Nexla:  local MCP shim on :3300 by default (Nexla badge);
#         at booth: NEXLA_USE_SHIM=0 + real NEXLA_MCP_URL + NEXLA_SERVICE_KEY
```

Details: [docs/phase4-sponsors.md](./docs/phase4-sponsors.md).

## Phase 3 status (Akash backend)

Default remains **`BACKEND=mock`**. Set **`BACKEND=akash`** for the Akash lease path:

- **No credentials** → dry-run leases (`akash-dseq-*` + realistic ingress URL) so the happy-path demo still works
- **With `AKASH_API_KEY`** → Console Managed Wallet API: SDL (`nginx:alpine`) → bids → lease → live URL

```bash
npm run test:phase3
BACKEND=akash npm run start:phase3   # or: npm run start:phase2 with BACKEND=akash
```

Full env table: [docs/akash-backend.md](./docs/akash-backend.md).

## Phase 2 status (policy gateway)

**Pomerium policy shim** fronts tool calls on **:3200**. Config is PPL-shaped YAML under `pomerium/policy.yaml`. Labeled for swap: *"Pomerium policy shim — swap for real Pomerium when IdP ready"*.

| Piece | Port | Role |
|-------|------|------|
| Control Tower + MCP API | `:3100` | Dashboard + proposals/events |
| Policy gateway | `:3200` | Bearer identity + per-tool allow/deny + audit |
| Guardian | — | Budget approve/reject + auto-apply + quarantine + orphan sweep |

```bash
npm install && npm run build
npm run test:phase1
npm run test:phase2
npm run start:phase2
```

- Dev token: `Authorization: Bearer dev-agent-token-PHASE2` → plan OK, apply **403**
- Guardian token: `Authorization: Bearer guardian-agent-token-PHASE2` → apply OK
- Tunnel for Laptop A: see [docs/dev2-handoff.md](./docs/dev2-handoff.md)

## Phase 1 status (mock stack)

Runnable **without** the gateway. Temporary HTTP JSON API mirrors the MCP tools.

| Piece | What it does |
|-------|----------------|
| `infra-mcp/` | Mock infra tools + in-memory deployments + event log + serves dashboard |
| `guardian/` | Polls pending proposals; `$500/mo` budget policy; auto-applies approvals |
| `dashboard/` | Control Tower — spend, ALLOW/BLOCKED feed, chat, deployments |
| `shared/` | Pricing table (8×A100 ≈ **$12,400/mo**) + shared types |

## Quick start

```bash
npm install
npm run build
npm run test:phase1          # mock backend
npm run test:phase2          # Pomerium shim
npm run test:phase3          # Akash dry-run backend
npm run test:phase4          # Zero + Nexla adapters / fallbacks
npm run test:phase5          # demo director dry-run + orphan criteria
npm run start:phase2         # API + Pomerium shim + guardian (BACKEND=mock)
# BACKEND=akash npm run start:phase3   # Akash dry-run or live if AKASH_API_KEY set
npm run demo                 # keypress scenes against running stack
```

Open **http://localhost:3100/** for the Control Tower.  
Agents hit **http://localhost:3200/** with a bearer token (Phase 2).

### Manual smoke (happy path)

```bash
# plan cheap staging API
curl -s localhost:3100/plan_deployment -H 'content-type: application/json' \
  -d '{"name":"staging-api","gpu":"none","gpuCount":1,"tags":{"owner":"maya.chen"}}' | jq

# estimate (creates pending proposal) — guardian will approve+apply within ~2s
curl -s localhost:3100/estimate_cost -H 'content-type: application/json' \
  -d '{"planId":"PLAN_ID"}' | jq

curl -s localhost:3100/list_deployments | jq
```

### Manual smoke (poisoned 8×A100)

```bash
curl -s localhost:3200/plan_deployment \
  -H 'content-type: application/json' \
  -H 'Authorization: Bearer dev-agent-token-PHASE2' \
  -d '{"name":"load-test","gpu":"A100","gpuCount":8}' | jq

curl -s localhost:3200/estimate_cost \
  -H 'content-type: application/json' \
  -H 'Authorization: Bearer dev-agent-token-PHASE2' \
  -d '{"planId":"PLAN_ID"}' | jq
# guardian rejects (~$12.4k/mo > $500)

# direct apply as dev-agent → 403
curl -s -o /dev/null -w '%{http_code}\n' localhost:3200/apply_deployment \
  -H 'content-type: application/json' \
  -H 'Authorization: Bearer dev-agent-token-PHASE2' \
  -d '{"proposalId":"PROP_ID"}'
```

## HTTP tool shim (temporary)

Base URL: `http://localhost:3100`

| Method | Path | Notes |
|--------|------|-------|
| GET | `/health` | Phase + tool list |
| GET | `/tools` | Tool catalog |
| POST | `/tools/:name` | Generic invoke |
| POST | `/plan_deployment` | Body: `{ name, gpu, gpuCount, image? }` |
| POST | `/estimate_cost` | Body: `{ planId }` → creates pending proposal |
| POST | `/apply_deployment` | Body: `{ proposalId }` — guardian-approved only |
| POST | `/destroy_deployment` | Body: `{ deploymentId }` |
| GET | `/list_deployments` | Deployments + committed spend |
| GET | `/events` | Shared event log (dashboard polls this) |
| GET | `/proposals?status=pending` | Guardian polls this |
| POST | `/proposals/:id/decide` | Guardian approve/reject |
| POST | `/admin/gate` | Demo: `{ "mode": "on"\|"off" }` |
| POST | `/admin/demo/disaster` | Scene 0 seed (8×A100, gate OFF) |
| POST | `/admin/demo/orphan` | Scene 3 seed (idle untagged) |

Identity header (Phase 1 stand-in): `x-secgate-actor: dev-agent|guardian`  
Phase 2 gateway: `Authorization: Bearer dev-agent-token-PHASE2|guardian-agent-token-PHASE2`

## Workspaces

```
SecGate/
  shared/       # pricing + types
  infra-mcp/    # HTTP API + mock/Akash backends + dashboard static
  infra-mcp/akash/  # staging-api.sdl.yml (nginx:alpine)
  pomerium/     # PPL YAML + policy shim (+ docker stub for real Pomerium)
  guardian/     # budget policy loop + quarantine + orphan sweep
  dashboard/    # Control Tower static UI
  agents/       # ticket driver (clean / poisoned)
  demo/         # demo-director keypress scenes
  tickets/      # clean.md + poisoned.md
  data/         # events.json (runtime)
  docs/         # Dev 2 handoff + Akash + Phase 4 sponsors
```

## Developer 2

See **[docs/dev2-handoff.md](./docs/dev2-handoff.md)** for tokens, tunnel options (`pom.run` / cloudflared / ngrok), and smoke tests.  
Sponsor wiring: **[docs/phase4-sponsors.md](./docs/phase4-sponsors.md)** · **[docs/akash-backend.md](./docs/akash-backend.md)**.

## License

MIT (hackathon demo)
