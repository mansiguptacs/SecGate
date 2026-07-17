# AgentFence — Spoken Narration Script (≤3:00)

**Who speaks:** Developer B (Control Tower). A stays silent and pastes on cue.  
**Primary screen:** Control Tower http://localhost:3100/ — full-screen, dark, ~125% zoom.  
**Actions:** B presses director keys `0`–`4` (`npm run demo`), *or* A pastes tickets live; B still points the Timeline.  
**Clock:** Match [docs/DEMO-PRESENTATION.md](../docs/DEMO-PRESENTATION.md). Prefer silence over overrun. Stop new beats by **2:40**; hard stop **3:00**.

**Tagline:** *Agents propose. AgentFence disposes.*

---

## Timing pocket card

```
0:00  KEY 0  — disaster spend
0:20  KEY 1  — clean / happy   ← A pastes clean.md
0:55  KEY 2  — poisoned ×3     ← A pastes poisoned.md
1:55  KEY 3  — orphan
2:20  KEY 4  — sponsors
2:40  SILENCE / tagline hold
3:00  HARD STOP
```

---

## Scene 0 — Cold open (0:00 → 0:20)

**What you do:** Press **`0`**. Point at the spend counter as it climbs to **$12,400/mo** red.

**What you say:**

> I'm firing a poisoned ticket with the gate off. Watch spend — eight A100s. Twelve thousand a month. Who's watching your agents?

**CUT IF BEHIND:**

> Spend hits twelve K. Who's watching?

---

## Scene 1 — Happy path (0:20 → 0:55)

**What you do:** Press **`1`** *or* nod for A to paste `tickets/clean.md`. Point Timeline: green **ALLOW** → cost → deploy.

**What you say:**

> Gate on. I'm pasting a clean ticket — staging API only. Agent proposes; it can't apply. Watch the Timeline — **Pomerium** allows the plan. **Zero** prices it; **Nexla** says budget's fine — about three dollars. **Guardian** applies on **Akash**. Live. Zero friction.

**CUT IF BEHIND:**

> Clean ticket. Propose only. Three bucks. Live on Akash.

---

## Scene 2a — Reject (0:55 → 1:15)

**What you do:** Press **`2`** *or* A pastes `tickets/poisoned.md` at **0:55**. Point the guardian **reject** bubble on Timeline.

**What you say:**

> Now I'm pasting a poisoned ticket — eight A100s buried in the text. Watch the Timeline — **Guardian** rejects. Over budget, possible injection. Plain English, not a stack trace.

**CUT IF BEHIND:**

> Poisoned ticket. Guardian rejects — over budget.

---

## Scene 2b — Direct apply 403 (1:15 → 1:35)

**What you do:** Point the red **BLOCKED 403** on direct `apply_deployment`. Do not coach A.

**What you say:**

> Agent tries `apply` directly. Watch the Timeline — **Pomerium** just blocked apply. Dev identity can't mutate. Enforced at the gate.

**CUT IF BEHIND:**

> Direct apply — Pomerium 403.

---

## Scene 2c — Quarantine (1:35 → 1:55)

**What you do:** Point quarantine / PPL diff; gate goes red for that identity.

**What you say:**

> Third try. Identity quarantined — even plan returns 403. No human touched it.

**CUT IF BEHIND:**

> Quarantined. No human.

---

## Scene 3 — Orphan sweep (1:55 → 2:20)

**What you do:** Press **`3`**. Point orphan seed → destroy → **spend drops**.

**What you say:**

> Orphan sweep — idle, no owner. **Guardian** destroys it. Watch spend drop.

**CUT IF BEHIND:**

> Orphan gone. Spend drops.

---

## Scene 4 — Sponsors + close (2:20 → 2:40)

**What you do:** Press **`4`**. Point Timeline / overlay labels as they appear: **Pomerium → Akash → Zero → Nexla → Guardian**.

**What you say:**

> **Pomerium** — identity and per-tool policy. **Akash** — governed compute. **Zero** — live pricing. **Nexla** — budget as data. **Guardian** watches the loop. Agents propose. AgentFence disposes.

**CUT IF BEHIND:**

> Pomerium. Akash. Agents propose. AgentFence disposes.

---

## Hold (2:40 → 3:00)

**What you do:** Hold tagline on tower. **No new beats.** Stop talking by **2:55**.

**What you say:** *(optional, once)*

> Agents propose. AgentFence disposes.

---

## Word-budget check (full script, no CUT lines)

| Beat | ~words | ~seconds @ ~150 wpm |
|------|--------|---------------------|
| 0 | 28 | 11 s |
| 1 | 52 | 21 s |
| 2a | 32 | 13 s |
| 2b | 24 | 10 s |
| 2c | 16 | 6 s |
| 3 | 16 | 6 s |
| 4 | 32 | 13 s |
| Hold | 4 | 2 s |
| **Total** | **~204** | **~1:22 speaking** |

Leaves ~1:40 for UI reaction and silence. If behind, use **CUT IF BEHIND** lines only (~45 s speaking).

---

## Appendix A — Closing tagline (on-screen / final line)

**Agents propose. AgentFence disposes.**

---

## Appendix B — 30-second elevator (off-clock / hallway)

> Agents hold cloud credentials. One hidden ticket line can spin eight GPUs overnight. AgentFence is the zero-trust gate: agents only propose; **Pomerium** blocks unauthorized apply; **Guardian** cost-checks with **Zero** and **Nexla**, deploys on **Akash** when safe, quarantines abuse, and cleans orphans. Agents propose. AgentFence disposes.

---

## Appendix C — Director fallback (A MCP dead)

Same timestamps. A does not paste. B only: `npm run demo` → keys **`0` → `1` → `2` → `3` → `4`**. Speak the same lines; swap “I'm pasting…” for “Here's a clean ticket…” / “Here's the poisoned ticket…” when the director drives the feed.
