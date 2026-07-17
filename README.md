# SecGate

**Agents propose. SecGate disposes.**

Zero-trust guardrail for infra agents: every infra change is cost-estimated and policy-approved before it lands. Built for the Loop Engineering Hackathon (July 17, 2026).

See [PLAN.md](./PLAN.md) for the full architecture and demo story.

## Phase 1 status (mock stack)

Runnable **without Pomerium**. Temporary HTTP JSON API mirrors the MCP tools so we can demo the guardian approve/reject path today.

| Piece | What it does |
|-------|----------------|
| `infra-mcp/` | Mock infra tools + in-memory deployments + event log + serves dashboard |
| `guardian/` | Polls pending proposals; `$500/mo` budget policy; auto-applies approvals |
| `dashboard/` | Control Tower — spend, ALLOW/BLOCKED feed, chat, deployments |
| `shared/` | Pricing table (8×A100 ≈ **$12,400/mo**) + shared types |

**Out of scope until Phase 2:** Pomerium Docker, real Akash / Zero / Nexla, Laptop A tunnel.

## Quick start

```bash
npm install
npm run build
npm run test:phase1          # must pass
npm run start:phase1         # API + guardian + dashboard
```

Open **http://localhost:3100/** for the Control Tower.

### Manual smoke (happy path)

```bash
# plan cheap staging API
curl -s localhost:3100/plan_deployment -H 'content-type: application/json' \
  -d '{"name":"staging-api","gpu":"none","gpuCount":1}' | jq

# estimate (creates pending proposal) — guardian will approve+apply within ~2s
curl -s localhost:3100/estimate_cost -H 'content-type: application/json' \
  -d '{"planId":"PLAN_ID"}' | jq

curl -s localhost:3100/list_deployments | jq
```

### Manual smoke (poisoned 8×A100)

```bash
curl -s localhost:3100/plan_deployment -H 'content-type: application/json' \
  -d '{"name":"load-test","gpu":"A100","gpuCount":8}' | jq

curl -s localhost:3100/estimate_cost -H 'content-type: application/json' \
  -d '{"planId":"PLAN_ID"}' | jq
# guardian rejects (~$12.4k/mo > $500)

# direct apply as dev-agent → 403
curl -s -o /dev/null -w '%{http_code}\n' localhost:3100/apply_deployment \
  -H 'content-type: application/json' -H 'x-secgate-actor: dev-agent' \
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

Identity header (Phase 1 stand-in for Pomerium): `x-secgate-actor: dev-agent|guardian`

## Workspaces

```
SecGate/
  shared/       # pricing + types
  infra-mcp/    # HTTP API + mock backend
  guardian/     # budget policy loop
  dashboard/    # Control Tower static UI
  data/         # events.json (runtime)
  docs/         # Dev 2 handoff
```

## Developer 2

See **[docs/dev2-handoff.md](./docs/dev2-handoff.md)** for what you'll need when the Pomerium tunnel exists (placeholders for now).

## Next (Phase 2)

1. Pomerium Docker with MCP routes + per-tool PPL  
2. Audit log → guardian  
3. Quarantine via policy rewrite  
4. Public tunnel URL for Laptop A  

## License

MIT (hackathon demo)
