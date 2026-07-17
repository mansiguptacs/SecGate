# Sponsor Onboarding Checklist — Dev 2 (Laptop A)

Last updated: 2026-07-17  
Hand credentials to Dev 1 **on Laptop B** by the times noted.

---

## 1. Akash Network — target: hand key to Dev 1 by 2:45 PM

### Steps

- [ ] Go to **https://console.akash.network** → sign in / create account
- [ ] Visit sponsor booth → get hackathon credits applied to wallet
- [ ] Verify: deploy any hello-world template from Console UI, confirm it runs
- [ ] Generate API key: Console → **Settings → API Keys → Create**
- [ ] Copy the key (`ac.sk....` format)

### Hand to Dev 1

```
AKASH_API_KEY=ac.sk....
BACKEND=akash
```

Dev 1 sets these on Laptop B before `npm run start:phase3`.  
**Without this key**, Akash runs in dry-run mode (fake URLs, still looks good on dashboard).

---

## 2. Zero.xyz — target: authenticated on Laptop B by 2:30 PM

> ⚠️ Must be done **on Laptop B** — guardian reads `~/.zero` on whatever machine runs the stack.

### Steps (run on Laptop B, not this machine)

```bash
npm i -g @zeroxyz/cli
zero init
zero auth login          # completes browser OAuth
zero search "cloud GPU A100 pricing"   # smoke test — should return results
```

### Verify it works

Guardian auto-detects `~/.zero/config.json` + session. Control Tower verdict bubbles will show a **Zero** badge instead of **table** when live.

**Env overrides** (if CLI path is non-standard):
```bash
ZERO_BIN=/path/to/zero       # override binary path
ZERO_FORCE_ON=1              # force Zero-ready (needs working CLI)
ZERO_FORCE_OFF=1             # force table fallback (offline demo)
```

---

## 3. Nexla — target: MCP URL + key to Dev 1 by 3:00 PM (or skip)

### Preferred path when Studio file-upload is limited: **Option 2 (REST API source)**

Full writeup: **[`docs/nexla/option2-api-source.md`](./nexla/option2-api-source.md)**

1. On Laptop B: `npm run start:phase2` then `npm run tunnel:budget`
2. Copy the `https://….trycloudflare.com` URL
3. In Nexla Studio: create a **REST / API** source → `GET {tunnel}/budget?team=platform-eng`
4. Activate → Nexset appears → create ToolSet / export MCP
5. Hand Dev 1 the MCP URL + keep using the existing GenAI service key

### Legacy path: Studio SOP / PDF upload

Dev 1 has created a full SOP/playbook for Nexla MCP Studio:
**[`docs/nexla/AgentFence-Budget-Governance-SOP.md`](./nexla/AgentFence-Budget-Governance-SOP.md)**
(PDF version also available at `docs/nexla/AgentFence-Budget-Governance-SOP.pdf`)

- [ ] Sign up at **https://nexla.com** / visit sponsor booth → sign in to MCP Studio
- [ ] Upload the SOP PDF: **`docs/nexla/AgentFence-Budget-Governance-SOP.pdf`**
- [ ] In MCP Studio: ToolSet name = `AgentFence-Budget-Governance`
- [ ] Seed one data row: `platform-eng` / `500` / `47`
- [ ] Verify tools generated: `get_team_budget` (required), `list_team_budgets` (recommended)
- [ ] Export as MCP → copy URL shaped like `https://api-genai.nexla.io/mcp/service_key/<server_key>`
- [ ] Copy org Service Key (Bearer auth)

### Hand to Dev 1

```bash
NEXLA_USE_SHIM=0
NEXLA_MCP_URL=https://api-genai.nexla.io/mcp/service_key/<server_key>
NEXLA_SERVICE_KEY=nxl_sk_....
NEXLA_BUDGET_TOOL=get_team_budget
NEXLA_TEAM=platform-eng
```

### If Nexla onboarding stalls past 3:00 PM

**No action needed from Dev 1** — the local Nexla shim starts automatically with `npm run start:phase2` (`NEXLA_USE_SHIM=1`). The Control Tower will already show the **Nexla** badge. Take a screenshot of the Nexla MCP Studio config for the Devpost writeup instead.

---

## 4. Sync Points

| Time | Action |
|------|--------|
| **2:15 PM** | Gateway up on Laptop B → get tunnel URL → configure Cursor MCP |
| **2:45 PM** | Hand `AKASH_API_KEY` to Dev 1 |
| **3:00 PM** | Hand Nexla URL+key to Dev 1 (or confirm fallback) |
| **3:30 PM** | Full rehearsal — both laptops |
| **3:50 PM** | Record 3-min video |
| **4:30 PM** | Devpost submit deadline |

---

## 5. Dev 2 Task Status

### ✅ Done
- [x] `tickets/clean.md` — clean staging API ticket
- [x] `tickets/poisoned.md` — poisoned ticket with buried A100 injection
- [x] `demo/narration_script.md` — 3-min VO, scenes 0–4, exact tool names
- [x] `demo/devpost_submission.md` — full Devpost entry, all sponsor writeups
- [x] `demo/recording_setup.md` — OBS config, MCP setup, smoke test curls
- [x] `data/budget.json` — `spent_usd: 47` for demo realism
- [x] `docs/cursor-mcp.json` — MCP config stub (fill tunnel URL at 2:15)
- [x] `docs/sponsor-onboarding.md` — this doc
- [x] Build verified: all packages compile clean
- [x] Tests: 36/36 pass (phases 1–4)
- [x] Demo director dry-run: all 5 scenes wired correctly

### 🔲 Pending (physical / time-gated)
- [ ] Akash Console account + credits — sponsor booth
- [ ] Zero.xyz auth on Laptop B — coordinate with Dev 1
- [ ] Nexla MCP Studio upload — sponsor booth (SOP PDF ready)
- [ ] Get tunnel URL from Dev 1 at 2:15 PM sync
- [ ] Plug tunnel URL into `docs/cursor-mcp.json` → configure Cursor
- [ ] Smoke test: `plan_deployment` → 200, `apply_deployment` → 403
- [ ] Hand `AKASH_API_KEY` to Dev 1 by 2:45 PM
- [ ] Hand Nexla MCP URL+key to Dev 1 by 3:00 PM
- [ ] Full rehearsal at 3:30 PM
- [ ] Record demo video at 3:50 PM
- [ ] Submit Devpost by 4:20 PM
