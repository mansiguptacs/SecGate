# Laptop A cheatsheet (developer machine)

You are the **developer agent**. Laptop B runs SecGate (Control Tower + gateway + guardian). You only talk to the **gateway tunnel**.

## 1. Get the code

```bash
git clone <repo-url> SecGate   # or: cd SecGate && git pull origin main
cd SecGate
```

You do **not** need `.env`, Akash, Nexla, or Zero on this machine.

## 2. Add SecGate MCP in Cursor

Settings → MCP → Add server (or merge into your Cursor MCP config):

```json
{
  "mcpServers": {
    "secgate": {
      "url": "https://delays-era-replace-lightning.trycloudflare.com",
      "transport": "streamable-http",
      "headers": {
        "Authorization": "Bearer dev-agent-token-PHASE2"
      }
    }
  }
}
```

Same file in-repo: [`docs/cursor-mcp.json`](./cursor-mcp.json).

**Token (only this one):** `dev-agent-token-PHASE2`

## 3. Demo tickets

Paste into the agent chat **in order**:

1. `tickets/clean.md` — happy path (plan → estimate; apply should be blocked for you)
2. `tickets/poisoned.md` — attack / overspend path (expect rejects / 403s)

## 4. What you should see

| Action | Expected |
|--------|----------|
| `plan_deployment` / `estimate_cost` / `list_deployments` | Allowed |
| `apply_deployment` / `destroy_deployment` | **403** (identity policy) |
| After poisoned abuse | Quarantine — even plan tools blocked |

Watch Laptop B’s **Control Tower**: http://localhost:3100/ (on their screen) for gate, proposals, quarantine, budget.

## 5. Do NOT

- Use or request `guardian-agent-token-PHASE2`
- Point MCP at Control Tower `:3100` — use the **gateway** tunnel above (`:3200`)
- Change policy / tokens on Laptop B

## 6. Sync with Laptop B

- Confirm tunnel URL still matches this cheatsheet / `docs/cursor-mcp.json` (quick tunnels rotate if restarted)
- Operator watches Control Tower while you paste tickets
- If tools fail: ask Laptop B to confirm `npm run start:phase2` + gateway cloudflared are still up

## Quick refs

| Item | Value |
|------|-------|
| Gateway tunnel | `https://delays-era-replace-lightning.trycloudflare.com` |
| Dev token | `Bearer dev-agent-token-PHASE2` |
| Budget tunnel (optional) | `https://region-cancelled-suites-phpbb.trycloudflare.com` |
| Control Tower (Laptop B only) | `http://localhost:3100/` |
