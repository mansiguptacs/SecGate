# Laptop A cheatsheet (developer machine)

You are the **developer agent**. Laptop B runs AgentFence (Control Tower + gateway + guardian). Prefer the **LAN gateway URL** — not ephemeral Cloudflare quick tunnels.

## 0. Connection preference (read this)

| Priority | When | MCP base URL |
|----------|------|--------------|
| **1. LAN (default)** | Same venue Wi‑Fi, no client isolation | `http://172.24.82.134:3200` |
| **2. Stable tunnel** | Guest Wi‑Fi blocks client↔client | URL in Laptop B’s `data/tunnel-url.txt` (localtunnel / named CF / ngrok / ssh -R) |
| **3. Quick tunnel** | Last resort only | `*.trycloudflare.com` — **dies and changes hostname** on restart |

Ask Laptop B for their LAN IP (or look at `docs/cursor-mcp.json`). Only ask for a tunnel if LAN curl/MCP fails.

**Token (only this one):** `dev-agent-token-PHASE2`

## 1. Get the code

```bash
git clone <repo-url> AgentFence   # or: cd AgentFence && git pull origin main
cd AgentFence
```

You do **not** need `.env`, Akash, Nexla, or Zero on this machine.

## 2. Add AgentFence MCP in Cursor

Settings → MCP → Add server (or merge into your Cursor MCP config).

### Prefer LAN (same Wi‑Fi) — use this

```json
{
  "mcpServers": {
    "secgate": {
      "url": "https://vary-five-patient-saving.trycloudflare.com",
      "transport": "streamable-http",
      "headers": {
        "Authorization": "Bearer dev-agent-token-PHASE2"
      }
    }
  }
}
```

Replace `172.24.82.134` with Laptop B’s current LAN IP if different (`ipconfig getifaddr en0` on their Mac).

Same file in-repo: [`docs/cursor-mcp.json`](./cursor-mcp.json).

### Backup — stable tunnel (only if LAN blocked)

Ask Laptop B to run `npm run start:stable` and paste the **BACKUP** URL from `data/tunnel-url.txt`. Then use that HTTPS URL in the same JSON shape.

Do **not** chase rotating `*.trycloudflare.com` quick-tunnel URLs unless both LAN and stable tunnel fail.

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
- Point MCP at Control Tower `:3100` — use the **gateway** `:3200` (LAN or stable tunnel)
- Change policy / tokens on Laptop B
- Depend on Cloudflare quick tunnels as the primary path

## 6. Sync with Laptop B

- **Default:** confirm LAN IP still matches this cheatsheet / `docs/cursor-mcp.json`
- If tools fail on LAN: ask them to confirm `npm run start:phase2` (or `npm run start:stable`) and that gateway listens on `0.0.0.0:3200`
- Tunnel backup only when venue Wi‑Fi has client isolation
- Operator watches Control Tower while you paste tickets

## Quick refs

| Item | Value |
|------|-------|
| **Gateway (LIVE tunnel)** | `https://vary-five-patient-saving.trycloudflare.com` |
| Gateway LAN fallback | `http://172.24.82.134:3200` |
| Dev token | `Bearer dev-agent-token-PHASE2` |
| Stable tunnel backup | See Laptop B `data/tunnel-url.txt` (gitignored) |
| Control Tower (Laptop B only) | `http://localhost:3100/` |
| Operator start (Laptop B) | `npm run start:stable` |
