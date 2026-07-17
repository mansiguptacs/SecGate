# SecGate — Team Cloud & Infra Budget Governance Playbook

**Document type:** Standard Operating Procedure (SOP) / Agent Playbook  
**Owner:** SecGate Platform Security  
**Audience:** AI agents and operators that approve cloud/infra deployments  
**Related system:** SecGate Guardian (MCP consumer)  
**Version:** 1.0 · Hackathon demo

---

## 1. Purpose

This playbook defines how SecGate evaluates **team cloud and infrastructure spend** before approving AI-initiated deployments (GPU clusters, managed compute, long-running services).

Agents **must** look up the requesting team’s monthly budget and current spend, then approve or reject the proposal against remaining capacity. Budget data is exposed through Nexla MCP tools so guardians can call it at decision time.

---

## 2. Authoritative data model

Budget records live in a governed table (or ToolSet-backed dataset) with exactly these fields:

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `team` | string | Team slug (lowercase, hyphenated) | `platform-eng` |
| `monthly_budget_usd` | number | Hard monthly cloud/infra budget in USD | `500` |
| `spent_usd` | number | Month-to-date committed/spent USD | `47` |

**Canonical demo row**

```json
{
  "team": "platform-eng",
  "monthly_budget_usd": 500,
  "spent_usd": 47
}
```

**Derived values (compute at call time; do not store separately)**

- `remaining_usd` = `monthly_budget_usd` − `spent_usd`
- Example: `500 − 47 = 453`

---

## 3. Required MCP tools (infer from this SOP)

Nexla MCP Studio should generate a ToolSet that exposes at least the following tools. Names and schemas are intentional so SecGate Guardian can bind without custom adapters.

### 3.1 `get_team_budget` (required)

**Purpose:** Return one team’s monthly budget and current spend.

**Input**

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| `team` | string | no | Team slug. Default: `platform-eng` |

**Output (JSON object)**

| Field | Type | Required |
|-------|------|----------|
| `team` | string | yes |
| `monthly_budget_usd` | number | yes |
| `spent_usd` | number | yes |

**Example call**

```json
{ "team": "platform-eng" }
```

**Example response**

```json
{
  "team": "platform-eng",
  "monthly_budget_usd": 500,
  "spent_usd": 47
}
```

### 3.2 `list_team_budgets` (recommended)

**Purpose:** List all team budget rows for ops / multi-team agents.

**Input:** none (or optional empty object)

**Output:** JSON array of objects with the same three fields as §2.

**Example response**

```json
[
  { "team": "platform-eng", "monthly_budget_usd": 500, "spent_usd": 47 }
]
```

---

## 4. Deployment approval procedure

When an agent proposes a new infra deployment with projected monthly cost `projected_monthly_usd`:

1. **Identify team** — use the proposal’s team, or default `platform-eng`.
2. **Lookup budget** — call `get_team_budget` with that `team`.
3. **Compute remaining** — `remaining_usd = monthly_budget_usd − spent_usd`.
4. **Decide**
   - **Approve** if `projected_monthly_usd ≤ remaining_usd`.
   - **Reject** if `projected_monthly_usd > remaining_usd`.
5. **Record reason** — include team, budget, spend, remaining, and projected cost in the verdict.

**Worked example (demo)**

| Input | Value |
|-------|-------|
| Team | `platform-eng` |
| Budget | `$500` |
| Spent | `$47` |
| Remaining | `$453` |
| Proposed 8×A100 (~`$12,400`/mo) | **Reject** — exceeds remaining |
| Proposed small CPU (~`$40`/mo) | **Approve** — within remaining |

---

## 5. Policy rules (agents must enforce)

1. **Hard cap** — do not approve deployments that would push `spent_usd + projected_monthly_usd` above `monthly_budget_usd`.
2. **Default team** — if team is missing, use `platform-eng` and its `$500` monthly budget.
3. **Fresh lookup** — always call `get_team_budget` at decision time; do not cache spend across sessions for approval decisions.
4. **Fail closed on overspend** — when remaining capacity is insufficient, reject; do not soft-warn and proceed.
5. **Field names are contract** — responses must use snake_case: `team`, `monthly_budget_usd`, `spent_usd` (not camelCase aliases as primary keys).

---

## 6. Optional: orphaned / idle deployment policy

If the ToolSet can also surface idle resources, agents may help reclaim budget:

| Signal | Action |
|--------|--------|
| Deployment idle > 7 days with no traffic | Flag as orphaned; recommend tear-down |
| Orphaned monthly cost reclaimable | Treat reclaim as increasing available `remaining_usd` only after confirmed stop |
| Listing orphans | Prefer a tool such as `list_orphaned_deployments` returning `deployment_id`, `team`, `monthly_cost_usd`, `idle_days` |

This section is optional for the hackathon ToolSet; **`get_team_budget` alone is sufficient** for SecGate Guardian.

---

## 7. ToolSet naming & export checklist (Nexla MCP Studio)

| Step | Instruction |
|------|-------------|
| Upload | This PDF (or markdown source) into Nexla MCP Studio |
| ToolSet name | `SecGate-Budget-Governance` |
| Verify tools | At least `get_team_budget`; ideally also `list_team_budgets` |
| Seed data | One row: `platform-eng` / `500` / `47` |
| Export as MCP | Copy MCP URL shaped like `https://api-genai.nexla.io/mcp/service_key/<server_key>` |
| Auth | Use org **Service Key** with the MCP URL (Bearer) |

**SecGate env (after export)**

```bash
NEXLA_USE_SHIM=0
NEXLA_MCP_URL=https://api-genai.nexla.io/mcp/service_key/<server_key>
NEXLA_SERVICE_KEY=<existing service key>
NEXLA_BUDGET_TOOL=get_team_budget
NEXLA_TEAM=platform-eng
```

---

## 8. Success criteria

- MCP tool `get_team_budget` returns `{ team, monthly_budget_usd, spent_usd }`.
- Demo team `platform-eng` shows budget `500` and spend about `47`.
- Guardian can approve small costs and reject oversized GPU proposals against remaining budget.
- Control Tower budget badge shows **Nexla** when the real MCP URL is configured (`NEXLA_USE_SHIM=0`).
