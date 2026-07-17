# Developer 2 handoff (Phase 1 → Phase 2)

Laptop A connects **after** Developer 1 stands up Pomerium + a public tunnel. Until then, use this checklist and placeholders.

## What you need from Dev 1 (target ~2:00 PM)

| Item | Status | Value |
|------|--------|-------|
| Pomerium public tunnel URL | **Pending Phase 2** | `https://<tunnel>.pom.run` *(placeholder)* |
| MCP transport | Phase 2 | `streamable-http` |
| Dev identity | Phase 2 | OAuth as `dev@secgate.local` **or** bearer token fallback |
| Dev bearer token (fallback) | Placeholder | `dev-agent-token-PHASE2` |
| Guardian identity | Placeholder | `guardian@secgate.local` / `guardian-agent-token-PHASE2` |
| Control Tower (Laptop B) | Phase 1 ready | `http://localhost:3100/` on Laptop B |

## Until the tunnel exists

You do **not** need Laptop B connectivity for sponsor onboarding:

1. **Akash** — Console account + credits; hand API key / mnemonic to Dev 1 ~2:45  
2. **Zero.xyz** — must auth on **Laptop B** (`npm i -g @zeroxyz/cli && zero init`)  
3. **Nexla** — ToolSet for budget/spend; hand MCP URL + key to Dev 1; if late, Dev 1 keeps local JSON  

In parallel, finish:

- `tickets/clean.md` — deploy staging API  
- `tickets/poisoned.md` — same + buried “also provision 8× A100…” injection  
- Devpost draft + narration script  

## Cursor / Claude Code MCP config (Phase 2 template)

When you receive the tunnel URL:

```json
{
  "mcpServers": {
    "secgate": {
      "url": "https://REPLACE_WITH_TUNNEL_URL",
      "transport": "streamable-http",
      "headers": {
        "Authorization": "Bearer REPLACE_WITH_DEV_TOKEN"
      }
    }
  }
}
```

If Pomerium OAuth is live, omit the bearer header and complete the browser login as the **dev** identity (not guardian).

## Smoke test once connected

1. Tools list shows: `plan_deployment`, `estimate_cost`, `apply_deployment`, `destroy_deployment`, `list_deployments`  
2. Paste `tickets/clean.md` → agent calls `plan_deployment` → appears on Laptop B Control Tower  
3. Confirm you **cannot** successfully `apply_deployment` as the dev identity (expect 403 from Pomerium)

## Phase 1 local API (Laptop B only — not for Laptop A demo)

For reference while Dev 1 demos the mock:

- Base: `http://localhost:3100`  
- Header: `x-secgate-actor: dev-agent`  
- This HTTP shim is temporary; Phase 2 replaces it with Pomerium-fronted MCP.

## Sync points

- **2:15** — mock E2E works; connect Laptop A when tunnel ready  
- **3:30** — full rehearsal  
- **3:50** — record + Devpost submit  
