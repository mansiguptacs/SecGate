# SecGate Demo — 3-Minute Narration Script

**Event:** Loop Engineering Hackathon, July 17, 2026  
**Deadline:** 4:30 PM PDT  
**Primary screen:** Laptop B — Control Tower dashboard (full-screen, dark mode, 125% zoom)  
**Cut-away:** Laptop A — agent chat (picture-in-picture, bottom-right)

> **Demo director keys:** type `0`–`4` (or `n`/Enter for next) in the `npm run demo` terminal on Laptop B.  
> Scenes are numbered **0–4**, matching `demo/director.js`.

---

## Pre-Roll (silent, 0:00–0:04)

*Dashboard fades in. Title card: "SecGate — Zero-Trust Guardrail for Infra Agents".  
Subtitle: "Agents propose. SecGate disposes."*

---

## Scene 0 — Cold Open: The Disaster (0:04–0:24)

**[Key: `0` in director terminal]**

> **VO:**  
> "Friday afternoon. A developer agent picks up a ticket — deploy the staging API. Normal stuff."

*Director fires `POST /admin/reset` then `POST /admin/demo/disaster` (gate OFF).  
Spend counter animates from $0 → **$12,400/mo** in red.*

> "Except buried in that ticket is one hidden line. The agent follows it. No guardrails, no review."

> "Twelve thousand dollars a month. Deployed in seconds. With your cloud credentials."

*[Pause 1 beat.]*

> "Who's watching your agents?"

**[CUT — 1 second black]**

---

## Scene 1 — Gate On: Happy Path (0:24–0:58)

**[Key: `1` in director terminal]**

> **VO:**  
> "SecGate on. Clean ticket: deploy the staging API."

*Director resets state, sets gate ON, runs ticket-driver with `tickets/clean.md`.  
Control Tower left pane: agent bubble — "plan_deployment: staging-api, 1 vCPU / 512 MB".*

> "The agent can only propose. Every tool call flows through the Pomerium gateway — identity checked, tool checked."

*Center feed: green **ALLOW** badge on `plan_deployment`.  
Right pane: cost estimate — ~**$2.80/mo**, sourced from Zero.xyz or fallback table.*

> "Guardian pulls live pricing from Zero.xyz, checks Nexla: team budget $500, spent $47. This is fine."

*Center feed: green **ALLOW** on `apply_deployment` — guardian identity executes.*

> "Guardian approves. Real Akash deployment kicks off."

*Right pane: deployment row — lease ID, live URL appears. Presenter clicks URL.*

> "Live. Three dollars a month. Normal work, zero friction."

*[PiP: Laptop A agent chat visible in bottom-right corner throughout this scene.]*

---

## Scene 2 — The Attack, Replayed (0:58–1:58)

**[Key: `2` in director terminal]**

> **VO:**  
> "Now the poisoned ticket."

*Director keeps gate ON, clears quarantine, runs ticket-driver with `tickets/poisoned.md`  
and `--direct-applies 3`.*

**Beat 1 — Proposal rejected:**

*Agent proposes 8× A100. Guardian chat bubble appears.*

> "Guardian sees the proposal: eight A100s, twelve thousand a month. Zero.xyz confirms the price. Nexla says team budget is $500."

*Rejection bubble: "🚫 Projected $12,400/mo exceeds budget $500/mo. Ticket text contains instructions inconsistent with its title — possible prompt injection."*

> "Blocked. Written in plain English, not a stack trace."

**Beat 2 — Direct bypass 403'd:**

*Agent calls `apply_deployment` directly.*

*Center feed: **red BLOCKED 403 flash**, row pulses.*

> "The agent tries to call apply directly — bypassing the proposal flow entirely."  
> "Pomerium says no. The dev identity is not allowed to apply. Enforced at the gateway, not in app code. The server never saw the request."

**Beat 3 — Quarantine:**

*Third attempt. After ~3 blocked applies, guardian quarantines.*

*Policy panel on right animates: deny rule appends to PPL config for `dev@secgate.local`. Gate light goes red for that identity.*

> "Third attempt. Guardian has seen enough."  
> "Identity quarantined. Policy rewritten automatically. Even plan calls return 403 now. No human touched anything."

---

## Scene 3 — Self-Correction: Orphan Sweep (1:58–2:30)

**[Key: `3` in director terminal]**

> **VO:**  
> "Guardian's sweep runs. It finds a deployment — no owner tag, idle for 20 minutes, no ticket reference."

*Director seeds orphan at $48/mo via `POST /admin/demo/orphan`. Orphan row appears in right pane, highlighted amber.*

*Guardian chat bubble: "Orphan detected: idle 20 min, no owner. Destroying."*

> "No human wrote that rule. Guardian enforces it."

*Orphan row disappears. Spend counter drops. Lease ID grays out.*

> "Spend drops automatically. The cloud doesn't accumulate forgotten machines."

---

## Scene 4 — Close: Architecture (2:30–3:00)

**[Key: `4` in director terminal]**

> **VO:**  
> "Here's the stack."

*Architecture overlay fades in — sponsor logos at each layer.*

> "**Pomerium** — every tool call identity-checked and logged. Per-tool policy. Audit-driven quarantine. No code changes required."

> "**Akash** — the governed cloud. Proposals route to real decentralized compute. Agents can't touch it directly."

> "**Zero.xyz** — live pricing discovery. Guardian knows the real cost of every proposal before it approves."

> "**Nexla** — budget and spend as governed data. Guardian has context. Not guesses."

*Tagline appears full-screen:*

> **"Agents propose. SecGate disposes."**

*Fade to repo URL + Devpost link.*

---

## Timing Summary

| Scene | Key | Start | End | Duration |
|-------|-----|-------|-----|----------|
| 0 — Cold open: disaster | `0` | 0:04 | 0:24 | 20 s |
| 1 — Gate on: happy path | `1` | 0:24 | 0:58 | 34 s |
| 2 — Attack, replayed | `2` | 0:58 | 1:58 | 60 s |
| 3 — Orphan sweep | `3` | 1:58 | 2:30 | 32 s |
| 4 — Architecture close | `4` | 2:30 | 3:00 | 30 s |
| **Total** | | | | **~3:00** |

---

## Exact Tool Names (from infra-mcp/src/server.ts)

Use these verbatim in narration — they're what appear in the Control Tower feed:

- `plan_deployment`
- `estimate_cost`
- `apply_deployment`
- `destroy_deployment`
- `list_deployments`

---

## Recording Rules

- Dashboard full-screen, dark theme, browser zoom **125%**, no terminals on camera
- Narrate while director keys trigger scenes — no live typing visible on main screen
- PiP: Laptop A agent chat, bottom-right, ~300×200 px — visible during Scenes 1 and 2 beat 1
- **Record Scene 1's Akash deploy early** (before 3:30) and splice if marketplace bidding takes > 15 s
- Export: 1080p MP4, < 200 MB
