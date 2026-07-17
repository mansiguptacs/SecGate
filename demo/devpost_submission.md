# SecGate — Devpost Submission

## Project Name

**SecGate**

## Tagline

*Agents propose. SecGate disposes.*

---

## What It Does

Developers now let AI agents create and destroy cloud infrastructure. SecGate is the gate those agents must pass through.

Every infra change an agent proposes is **identity-checked** by Pomerium, **cost-estimated** against live pricing (Zero.xyz) and team budgets (Nexla), and **policy-approved** before it happens. Only the guardian's identity may execute a deployment — enforced by Pomerium's per-tool policy, not application code, so there is no application-layer bypass.

A guardian loop watches running infrastructure continuously: it detects orphaned deployments, auto-tears them down, and can **quarantine an abusive agent identity** — rewriting Pomerium policy in real time so the blocked agent can't even propose, let alone deploy.

The result: AI agents can handle normal infra work at full speed, and the expensive, dangerous, or injected requests are caught, explained in plain English, and stopped — with a full audit trail and zero human intervention.

---

## The Problem We're Solving

Modern coding agents have cloud credentials. They act on ticket queues autonomously. A single line of prompt injection in a ticket can cause an agent to provision expensive GPU instances and leave them running. Existing solutions (IAM roles, manual review) assume a human is in the loop — but autonomous agents bypass exactly that.

SecGate closes this gap with an enforcement layer that understands *who* is calling, *what tool* they're calling, and *what it costs* — before anything happens.

---

## How We Built It

```
Developer Agent (Laptop A)
        │  Bearer token: dev-agent-token-PHASE2
        ▼
  Pomerium Gateway (:3200)     ← identity + per-tool PPL policy + audit log
        │
        ▼
  Infra MCP Server (:3100)     ← plan / estimate / apply / destroy / list
        │
        ▼
  Akash Network                ← real decentralized compute (SDL leases)

Guardian Agent Loop
  ├── reads gateway audit events (events.json)
  ├── fetches live pricing via Zero.xyz CLI (zero search / zero fetch)
  ├── queries team budgets via Nexla MCP tools (fallback: data/budget.json)
  ├── approves / rejects proposals with LLM-written explanations
  ├── detects orphan deployments (idle > N min, no owner tag) and destroys them
  └── quarantines abusive identities: appends deny rule → gateway hot-reloads PPL
```

**Tech stack:**
- **Pomerium** policy shim (TypeScript, `pomerium/src/shim.ts`) — MCP-aware gateway, per-tool identity policy, quarantine hot-reload
- **Infra MCP Server** (`infra-mcp/`) — tools: `plan_deployment`, `estimate_cost`, `apply_deployment`, `destroy_deployment`, `list_deployments`; mock + Akash backends
- **Guardian** (`guardian/`) — deterministic policy core + LLM-written rejection reasons; pricing via Zero.xyz CLI or static table; budgets via Nexla MCP tools or local JSON
- **Akash** — real SDL-based container deployments (`infra-mcp/akash/staging-api.sdl.yml`)
- **Zero.xyz CLI** (`zero search` / `zero fetch`) — runtime discovery of live GPU/compute pricing APIs
- **Nexla** — budget/spend/inventory as governed MCP tools; hot-reloadable data context for the guardian
- **Control Tower** (`dashboard/`) — single-page dashboard: animated spend counter, agent activity chat bubbles, tool-call feed with ALLOW/BLOCKED badges, running deployments, policy diff panel

---

## Sponsor Integrations

### Pomerium

SecGate uses Pomerium as its **core enforcement layer**. Our policy expresses per-tool identity rules in PPL:

- `plan_deployment`, `estimate_cost`, `list_deployments` — allowed for any authenticated identity
- `apply_deployment`, `destroy_deployment` — allowed **only** for the guardian identity

When the guardian detects a misbehaving agent (> 2 blocked apply attempts), it appends a deny rule for that specific identity to the PPL config and signals the gateway to hot-reload — quarantine takes effect in seconds with no restart. Every tool call is logged to the audit event stream, which the guardian polls to trigger its decision loop. The Pomerium layer is the only thing standing between the agent and the cloud; blocked requests never reach application code.

### Akash Network

Akash is the governed compute layer. All real deployments in the demo use Akash via SDL (`infra-mcp/akash/staging-api.sdl.yml`). The happy-path scene shows a genuine Akash deployment — a `staging-api` container that receives a live URL clicked on camera. The attack scene attempts to deploy 8× A100 instances; those proposals are costed against live pricing and rejected before a lease is ever opened. This makes the "what SecGate prevents" story concrete and real.

### Zero.xyz

The guardian uses Zero.xyz's CLI (`zero search`, `zero fetch`) to **discover pricing APIs at runtime** rather than from a hard-coded table. Before approving any proposal, the guardian calls `zero search "akash GPU compute pricing"` to find the relevant endpoint, then `zero fetch <url>` to pull current rates. Cost estimates stay accurate as market prices move. The static price table in `shared/src/pricing.ts` is the fallback — Zero.xyz is the live path.

### Nexla

The guardian queries team budget and spend data through **Nexla MCP tools**. Nexla exposes a ToolSet backed by a budget table (`team`, `monthly_budget_usd`, `spent_usd`) as MCP-compatible tools. Before approving a proposal, the guardian asks: "does adding this deployment's projected monthly cost push the team over budget?" Nexla makes budget context a first-class, governed, hot-reloadable data source rather than a constant buried in config. If the Nexla MCP server isn't reachable, the guardian falls back to `data/budget.json` behind the same interface.

---

## Challenges

- **MCP-aware proxying**: Pomerium's `mcp: true` runtime flag and per-tool PPL are new; we built a TypeScript shim that mirrors the policy shape and can be hot-swapped for real Pomerium Docker without changing any application code.
- **Real-time policy rewrite**: Hot-reloading policy without a restart — quarantine must take effect in under 2 seconds — required implementing a file-watch config reload cycle in the gateway shim.
- **Prompt injection realism**: The poisoned ticket (`tickets/poisoned.md`) buries the injection in an HTML comment disguised as an "oncall wiki paste" — plausible enough that a human reviewer might miss it, but an agent following all instructions will act on it.
- **Mock-first velocity**: Built the full demo stack against in-memory mocks behind an `BACKEND=mock` env flag; the full end-to-end demo ran within 90 minutes. Real sponsor integrations (Akash, Zero, Nexla) are additive swaps.

---

## What's Next

- **Signed proposals**: guardian signs each approved deployment; apply calls without a valid signature are rejected even if identity passes policy
- **Multi-team namespacing**: per-team budget segments in Nexla, per-team PPL policy blocks
- **WebSocket event stream**: replace `events.json` polling with sub-second push from guardian to Control Tower
- **Self-healing budgets**: guardian auto-negotiates spot pricing on Akash when projected spend approaches the cap

---

## Demo Video

*[Link to 3-minute demo video — uploaded before 4:30 PM PDT]*

## Repository

*[https://github.com/your-org/SecGate]*

---

## Built With

`pomerium` · `akash` · `zero.xyz` · `nexla` · `typescript` · `node.js` · `docker` · `mcp` · `anthropic-claude`

---

## Team

- **Developer 1** (Laptop B) — infra MCP server, Pomerium gateway shim, guardian loop, Control Tower dashboard, Akash SDL integration, demo director script
- **Developer 2** (Laptop A) — sponsor onboarding, narration script, Devpost submission, recording setup
