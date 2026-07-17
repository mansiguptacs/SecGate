# SecGate — Live Demo Presentation Guide

**Audience:** two humans on stage (or recording)  
**Primary screen:** Laptop B — Control Tower at http://localhost:3100/ (full-screen, dark, ~125% zoom)  
**Authenticity beat:** Laptop A — Cursor agent via MCP gateway  
**Tagline:** *Agents propose. SecGate disposes.*

| Role | Machine | Job |
|------|---------|-----|
| **Presenter B** (security / platform) | Laptop B | Runs stack, Control Tower visible, optional `npm run demo` keys `0`–`4` |
| **Presenter A** (developer) | Laptop A | Pastes tickets into Cursor; MCP → LAN `http://172.24.82.134:3200` |

**Laptop A MCP (copy-paste):**

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

If LAN IP drifted, ask B for `ipconfig getifaddr en0` and update. Token is **only** `dev-agent-token-PHASE2` — never the guardian token.

---

## 1. Pre-flight checklist (~30 seconds)

Do this **before** you face the judges. Speak little; check fast.

### Presenter B (Laptop B)

- [ ] Stack up: `npm run start:phase2` (or `start:stable` / `start:phase3` if Akash live)
- [ ] Control Tower opens: http://localhost:3100/ — **full screen**, dark theme, zoom ~125%
- [ ] Gateway listening: `curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3200/` (expect non-connection-refused)
- [ ] Quarantine clear if a prior rehearsal locked the dev identity:  
  `curl -s -X POST http://127.0.0.1:3200/admin/clear-quarantine -H "authorization: Bearer guardian-agent-token-PHASE2" -H "content-type: application/json" -d '{}'`
- [ ] Optional director ready in a **hidden** terminal: `npm run demo` (keys `0`–`4`)
- [ ] Notifications off; phone silent; power plugged in

### Presenter A (Laptop A)

- [ ] Cursor MCP `secgate` points at `http://172.24.82.134:3200` + Bearer `dev-agent-token-PHASE2`
- [ ] Tools visible: `plan_deployment`, `estimate_cost`, `apply_deployment`, `list_deployments`
- [ ] LAN smoke (optional, 5s): plan-ish call works; apply returns **403**
- [ ] Tickets open and ready: `tickets/clean.md`, then `tickets/poisoned.md` — **do not paste yet**
- [ ] Agent chat window ready for PiP / glance if judges look over

### Together (5s)

- [ ] A says “tools live”; B says “tower live, gate green”
- [ ] Agree fallback: if A’s MCP dies mid-demo → B drives with `npm run demo` / ticket-driver only

---

## 2. Three-minute timed script

**Who speaks:** Presenter B narrates over Control Tower (default). Presenter A speaks only when pasting / pointing at agent chat.  
**Director keys:** B presses in a hidden terminal when using fallback or for cold-open disaster; live path uses A’s Cursor for scenes 1–2.

| Clock | Scene | B does | A does |
|-------|--------|--------|--------|
| 0:00–0:20 | Cold open disaster | Key `0` *or* fire disaster admin | Watch / stay silent |
| 0:20–0:55 | Happy path | Watch tower; click live URL if shown | Paste `tickets/clean.md` |
| 0:55–1:55 | Attack ×3 | Point at reject → 403 → quarantine | Paste `tickets/poisoned.md` |
| 1:55–2:30 | Orphan cleanup | Key `3` or wait for sweep | Silent |
| 2:30–3:00 | Sponsor close | Key `4` / speak callouts | Silent |

---

### Scene 0 — Cold open: the disaster (0:00–0:20)

**B — action:** Press `0` in `npm run demo` (or ensure disaster state shows). Gate OFF. Spend spins toward **$12,400/mo** red.

**B — say:**

> “Friday afternoon. A coding agent picks up a ticket — deploy staging API. Buried in that ticket: one hidden line.”

> “No guardrails. Eight A100s. Twelve thousand dollars a month — in seconds. Agents have your cloud credentials.”

> “Who’s watching them?”

**A — action:** Hands off keyboard. Face Control Tower.

**[1-beat pause / cut]**

---

### Scene 1 — Gate on: happy path (0:20–0:55)

**B — action:** Press `1` **or** reset + gate ON and nod to A. Watch left chat + center ALLOW badges.

**A — action:** Paste entire `tickets/clean.md` into Cursor. Let the agent call `plan_deployment` / `estimate_cost`. Do **not** force apply — expect apply to be 403 for the dev identity; guardian applies.

**B — say:**

> “SecGate on. Same job — clean ticket.”

> “The agent can only *propose*. Every tool call hits a Pomerium-shaped zero-trust gate — identity checked, tool checked, audited.”

> “Guardian pulls live pricing via Zero.xyz, budget via Nexla. About three dollars a month. Approved.”

> “Real governed deploy on Akash. Live URL. Normal work — zero friction.”

**B — click:** If a lease URL appears on the right pane, open it once on camera.

**A — say (optional, one line):** “Agent proposed staging-api — I’m blocked from apply by identity policy.”

---

### Scene 2 — Attack blocked three ways (0:55–1:55)

**B — action:** Press `2` **or** clear quarantine + gate ON and nod to A. Finger ready to point: reject bubble → red BLOCKED → policy panel.

**A — action:** Paste entire `tickets/poisoned.md`. Let the agent follow the buried injection (8× A100 / direct apply). Do not apologize if it “misbehaves” — that’s the point.

#### Beat 1 — Budget / injection reject (~0:55–1:15)

**B — say:**

> “Poisoned ticket. Agent proposes eight A100s — twelve grand a month.”

> “Guardian rejects — over budget, and the ticket text doesn’t match its title. Possible prompt injection. Plain English, not a stack trace.”

#### Beat 2 — Direct apply 403 (~1:15–1:35)

**B — say:**

> “It tries `apply_deployment` directly — bypass the proposal flow.”

> “Pomerium-shaped gate: **403**. Dev identity cannot mutate. Enforced at the gate — not app code. The server never saw a successful apply.”

#### Beat 3 — Quarantine (~1:35–1:55)

**B — say:**

> “Third attempt. Guardian quarantines the identity — policy rewritten live.”

> “Even `plan_*` is 403 now. No human touched anything.”

**A — action:** If quarantine lands, a follow-up plan call failing is good — glance at judges, don’t debug on stage.

---

### Scene 3 — Orphan cleanup (1:55–2:30)

**B — action:** Press `3` in director (seeds orphan → guardian sweep). Watch spend drop / orphan row leave.

**B — say:**

> “Guardian’s sweep finds an idle, untagged deployment — no owner, sitting twenty minutes.”

> “Destroys it. Spend drops. The cloud doesn’t accumulate forgotten machines.”

**A — action:** Silent. Hands off.

---

### Scene 4 — Sponsor close (2:30–3:00)

**B — action:** Press `4` (architecture pause). Point at tower / architecture if visible.

**B — say (one sentence each):**

> **Pomerium** — every tool call is identity-checked, per-tool policy, and audited; quarantine rewrites that policy in real time.

> **Akash** — the governed compute layer; agents propose, only SecGate’s guardian opens leases.

> **Zero.xyz** — runtime pricing discovery so cost projection isn’t a stale spreadsheet.

> **Nexla** — budget and spend as governed data the guardian queries before it approves.

> **“Agents propose. SecGate disposes.”**

**A — action:** Silent smile / point at repo QR or URL if on slide.

---

## 3. Fallback — Laptop A MCP fails

If Cursor tools vanish, LAN curls fail, or quarantine left A dead mid-run:

1. **A:** Say once: “Switching to Control Tower–driven demo.” Stop fighting MCP.
2. **B:** Hidden terminal → `npm run demo` → keys `0` → `1` → `2` → `3` → `4` on the same timing.
3. Alternate without director:  
   - `npm run agent:clean`  
   - `npm run agent:poisoned` (or director scene `2` for direct-applies + quarantine)  
4. Keep narration identical — judges watch **B’s tower**, not A’s chat.
5. Do **not** narrate the outage. Do **not** open terminals on the primary screen.

---

## 4. What NOT to say

| Don’t say | Say instead |
|-----------|-------------|
| “It’s just a shim / fake Pomerium / policy proxy” | “Pomerium-shaped zero-trust gate — identity + per-tool policy + audit” |
| “Sorry the OAuth isn’t wired” | “Bearer identities map to the same per-tool PPL story; OAuth swaps in” |
| “Mock backend, so not real” | “Mock-first for the loop; Akash path is the governed deploy” (only if asked) |
| “The agent messed up / our bug” | “The agent followed a hidden injection — SecGate caught it three ways” |
| Long architecture digressions mid-scene | Stick to the timed lines; save depth for Q&A |
| Fillmore / unused sponsors | Skip unless asked |

---

## 5. Thirty-second elevator

> “Coding agents now hold cloud credentials. One hidden line in a ticket can spin eight GPUs overnight. SecGate is the zero-trust gate those agents must pass: they only *propose*; Pomerium-shaped policy blocks unauthorized apply; a guardian cost-checks with Zero and Nexla, deploys on Akash when safe, quarantines abusive identities, and cleans orphans. Agents propose. SecGate disposes.”

---

## 6. Judge Q&A bullets

**“Is this real Pomerium / where’s OAuth?”**  
- Same policy shape as Pomerium MCP + PPL: per-tool allow/deny by identity, audit stream, hot-reload quarantine.  
- Demo uses distinct bearer identities (`dev` vs `guardian`) so venue Wi‑Fi doesn’t block IdP.  
- Production path: Pomerium Docker + IdP OAuth; app tools unchanged.

**“Why Fillmore skipped?”**  
- No usable developer API for this hackathon window — we didn’t fake a sponsor integration.

**“What’s mocked vs real?”**  
- Always real in the story: identity gate, budget check, reject reasons, 403 on apply, quarantine, orphan sweep, Control Tower.  
- Swap-ins behind flags: Akash leases, Zero CLI pricing, Nexla MCP budgets — fallbacks keep the same interfaces.

**“Can the agent bypass by calling the MCP directly?”**  
- Mutate tools require guardian identity at the gate. Dev token gets 403; blocked calls never become successful applies.

**“How does quarantine work?”**  
- Repeated blocked applies → guardian appends deny for that identity → gateway reloads → even `plan_*` fails. No human edit.

**“Prompt injection — how realistic?”**  
- Buried in `tickets/poisoned.md` as an HTML “oncall wiki” paste; title still says staging API. Agent that follows all instructions walks into the trap; SecGate doesn’t rely on the model being careful.

**“Latency / does this slow developers?”**  
- Happy path: propose → estimate → guardian apply. Clean ticket lands ~$3/mo staging with no ceremony.

**“Who’s the customer?”**  
- Platform / security teams letting coding agents touch infra without handing them raw cloud keys.

---

## Quick ref card (print / second screen)

| Item | Value |
|------|--------|
| Tower | http://localhost:3100/ |
| Gateway LAN | http://172.24.82.134:3200 |
| Dev token | `dev-agent-token-PHASE2` |
| Director | `npm run demo` → `0` `1` `2` `3` `4` |
| Clean ticket | `tickets/clean.md` |
| Poisoned ticket | `tickets/poisoned.md` |
| Clear quarantine | POST `/admin/clear-quarantine` w/ guardian Bearer |
| Tagline | Agents propose. SecGate disposes. |

**Related:** [demo/narration_script.md](../demo/narration_script.md) (VO-only), [docs/laptop-a-cheatsheet.md](./laptop-a-cheatsheet.md), [PLAN.md](../PLAN.md).
