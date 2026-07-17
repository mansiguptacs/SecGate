# SecGate — Live Demo Presentation Guide

**HARD LIMIT: demo ≤ 3:00 total.** Hackathon requirement. If behind, skip every line marked **CUT IF BEHIND**. Prefer silence over overrun.

**Primary screen:** Laptop B — Control Tower http://localhost:3100/ (full-screen, dark, ~125% zoom)  
**Tagline:** *Agents propose. SecGate disposes.*

| Role | Machine | Job |
|------|---------|-----|
| **Presenter B** | Laptop B | Control Tower + optional `npm run demo` keys `0`–`4` |
| **Presenter A** | Laptop A | Paste tickets; MCP → `http://172.24.82.134:3200` |

**Laptop A MCP:**

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

Token: **only** `dev-agent-token-PHASE2`. If LAN IP drifted, ask B for `ipconfig getifaddr en0`.

---

## Hard timing budget (must hit)

| Scene | Clock | Max | Buffer rule |
|-------|-------|-----|-------------|
| 0 Cold open | 0:00–0:20 | **20s** | Advance at 0:20 even if mid-sentence |
| 1 Happy path | 0:20–0:55 | **35s** | Skip URL click if behind |
| 2 Attack ×3 | 0:55–1:55 | **60s** | One sentence per beat; drop CUT lines |
| 3 Orphan | 1:55–2:20 | **25s** | One line + watch spend drop |
| 4 Sponsors | 2:20–2:40 | **20s** | Four short callouts + tagline |
| **Reserve** | 2:40–3:00 | **20s** | Silence / tagline hold — **never start a new beat after 2:40** |
| **TOTAL** | | **≤3:00** | Stop talking at 2:55 |

Spoken pace: ~2 words/sec. Lines below are sized to fit.

---

## 1. Pre-flight (BEFORE clock starts — not part of 3:00)

### B
- [ ] `npm run start:phase2` (or `start:stable` / `start:phase3`)
- [ ] http://localhost:3100/ full-screen
- [ ] Gateway :3200 up
- [ ] Quarantine cleared if needed (guardian Bearer POST `/admin/clear-quarantine`)
- [ ] Hidden terminal: `npm run demo`
- [ ] Notifications off

### A
- [ ] MCP LAN + Bearer `dev-agent-token-PHASE2`
- [ ] Tools listed
- [ ] `tickets/clean.md` + `tickets/poisoned.md` ready — **not pasted**
- [ ] Fallback agreed: B-only director if MCP dies

---

## 2. Strict ≤3:00 script

**Who speaks:** B only (default). A pastes, does not narrate unless noted.  
**Director:** B presses `0`–`4` in hidden terminal (or A pastes for scenes 1–2 live).

---

### Scene 0 — Cold open (0:00–0:20) — MAX 20s

**B action:** Key `0`. Spend → **$12,400/mo** red.

**B say (all of this ≤18s speaking):**

> “Hidden line in a ticket. Agent spins eight A100s — twelve thousand a month. No guardrails.”

> “Who’s watching your agents?”

**CUT IF BEHIND:** “Friday afternoon / deploy staging API” setup. Jump straight to spend + “Who’s watching…”

**A:** Silent. Face tower.

**At 0:20 → key `1` / start scene 1. No pause.**

---

### Scene 1 — Happy path (0:20–0:55) — MAX 35s

**A action:** Paste `tickets/clean.md` immediately when B nods.  
**B action:** Key `1` *or* gate ON. Watch ALLOW badges.

**B say (≤25s speaking; leave ~10s for UI):**

> “SecGate on. Clean ticket — agent can only propose.”

> “Zero prices it, Nexla checks budget: three dollars. Guardian applies on Akash.”

> “Live. Zero friction.”

**CUT IF BEHIND:** “Pomerium-shaped zero-trust gate — identity checked, tool checked.”  
**CUT IF BEHIND:** Clicking the live URL (glance only).  
**CUT IF BEHIND (A):** “I’m blocked from apply by identity policy.”

**At 0:55 → start scene 2 even if deploy URL still loading.**

---

### Scene 2 — Attack blocked 3 ways (0:55–1:55) — MAX 60s

**A action:** Paste `tickets/poisoned.md` at 0:55.  
**B action:** Key `2` *or* clear quarantine + gate ON. Point: reject → 403 → quarantine.

#### Beat 1 — Reject (0:55–1:15) — ≤20s

> “Poisoned ticket — eight A100s. Guardian rejects: over budget, likely injection.”

**CUT IF BEHIND:** “Plain English, not a stack trace.”

#### Beat 2 — 403 (1:15–1:35) — ≤20s

> “Direct `apply` — **403**. Dev identity can’t mutate. Gate, not app code.”

**CUT IF BEHIND:** “The server never saw a successful apply.”

#### Beat 3 — Quarantine (1:35–1:55) — ≤20s

> “Third try — identity quarantined. Even plan is 403. No human touched it.”

**CUT IF BEHIND:** Waiting for a second plan failure on A’s screen.

**At 1:55 → key `3`. Do not extend beats.**

---

### Scene 3 — Orphan (1:55–2:20) — MAX 25s

**B action:** Key `3`. Watch orphan seed → destroy → spend drop.  
**A:** Silent.

**B say (≤12s):**

> “Orphan sweep — idle, no owner. Destroyed. Spend drops.”

**CUT IF BEHIND:** “sitting twenty minutes” / “forgotten machines.” Just point at the counter.

**At 2:20 → key `4`.**

---

### Scene 4 — Sponsors (2:20–2:40) — MAX 20s

**B action:** Key `4`. Rapid fire — one breath each:

> **Pomerium** — identity, per-tool policy, audit, live quarantine.  
> **Akash** — governed compute; only guardian opens leases.  
> **Zero** — live pricing before approve.  
> **Nexla** — budget as governed data.  
> **“Agents propose. SecGate disposes.”**

**CUT IF BEHIND:** Drop Zero + Nexla to: “Zero prices. Nexla budgets.” Then tagline only.  
**CUT IF BEHIND:** Any architecture overlay explanation.

**2:40–3:00:** Hold tagline / tower. **Stop talking by 2:55.**

---

## Timing cheat-sheet (say aloud during rehearsal)

```
0:00  KEY 0  — disaster
0:20  KEY 1  — clean / happy
0:55  KEY 2  — poisoned / 3 blocks
1:55  KEY 3  — orphan
2:20  KEY 4  — sponsors
2:40  SILENCE / tagline hold
3:00  HARD STOP
```

---

## 3. Fallback — A MCP fails (same clock)

1. A (once): “Tower-driven.”  
2. B: `npm run demo` → `0` `1` `2` `3` `4` on the **same** timestamps above.  
3. Same short lines. No debugging on the clock.

---

## 4. What NOT to say

| Don’t | Do |
|-------|-----|
| “shim / fake Pomerium / policy proxy” | “Pomerium-shaped zero-trust gate” |
| Apologize for OAuth / mock | Save for Q&A |
| “The agent messed up” | “Hidden injection — caught three ways” |
| Extra architecture mid-scene | Stick to the lines; cut CUT IF BEHIND |

---

## 5. Thirty-second elevator (off-clock / hallway only)

> “Agents hold cloud credentials. One hidden ticket line can spin eight GPUs overnight. SecGate is the zero-trust gate: agents only propose; policy blocks unauthorized apply; a guardian cost-checks with Zero and Nexla, deploys on Akash when safe, quarantines abuse, cleans orphans. Agents propose. SecGate disposes.”

---

## 6. Judge Q&A (after the 3:00 — not in the demo)

- **Real Pomerium / OAuth?** Same PPL shape; bearers for venue; OAuth swaps in.  
- **Fillmore?** No usable API — skipped.  
- **Mock vs real?** Gate, budget, 403, quarantine, orphan, tower always real; Akash/Zero/Nexla behind flags.  
- **Bypass?** Mutate = guardian identity only.  
- **Quarantine?** Blocked applies → deny identity → even `plan_*` fails.  
- **Injection?** HTML “oncall wiki” paste in `tickets/poisoned.md`.

---

## Quick ref

| Item | Value |
|------|--------|
| Tower | http://localhost:3100/ |
| Gateway | http://172.24.82.134:3200 |
| Token | `dev-agent-token-PHASE2` |
| Keys | `0` `1` `2` `3` `4` at 0:00 / 0:20 / 0:55 / 1:55 / 2:20 |
| Hard stop | **3:00** |

**Related:** [demo/narration_script.md](../demo/narration_script.md), [docs/laptop-a-cheatsheet.md](./laptop-a-cheatsheet.md), [PLAN.md](../PLAN.md).
