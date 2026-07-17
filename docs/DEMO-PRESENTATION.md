# SecGate — Live Demo Playbook (≤3:00)

**Hard limit:** total demo ≤ **3:00**. Prefer silence over overrun. Stop all new beats by **2:40**; hard stop at **3:00**.

**Primary screen:** Laptop B — Control Tower http://localhost:3100/ (full-screen, dark, ~125% zoom)  
**Tagline:** *Agents propose. SecGate disposes.*

---

## 1. Roles

| Role | Machine | Owns |
|------|---------|------|
| **Developer A** | Laptop A | Cursor agent + SecGate MCP. Pastes tickets on cue. Does **not** narrate. |
| **Developer B** | Laptop B | Full stack + Control Tower + hidden `npm run demo` keys `0`–`4`. Points at Timeline. Optional short VO. |

**Clock owner:** B. Advance on the timestamps below even if UI is mid-animation.

---

## 2. Laptop A — MCP connection (keep this)

Prefer LAN. Ask B for a fresh IP if curl fails (`ipconfig getifaddr en0` on B).

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

| Item | Value |
|------|--------|
| Gateway (LAN) | `http://172.24.82.134:3200` |
| Token | **only** `dev-agent-token-PHASE2` |
| Tower (B’s screen) | http://localhost:3100/ |

Do **not** use `guardian-agent-token-PHASE2`. Do **not** point MCP at `:3100`.

---

## 3. Pre-flight checklist (before clock starts)

### Developer B

- [ ] Stack up: `npm run start:phase2` (or `start:stable` / `start:phase3`)
- [ ] Control Tower open: http://localhost:3100/ — full-screen, dark, ~125% zoom
- [ ] Gateway listening on `:3200`
- [ ] Quarantine cleared if needed (guardian Bearer → POST `/admin/clear-quarantine`)
- [ ] Hidden terminal ready: `npm run demo` (keys `0`–`4`)
- [ ] Give A current LAN IP if not `172.24.82.134`
- [ ] Notifications / Focus / Do Not Disturb on
- [ ] Agree fallback: if A MCP dies → B-only director (section 5)

### Developer A

- [ ] MCP config = LAN URL + Bearer `dev-agent-token-PHASE2` (section 2)
- [ ] MCP tools listed: `plan_deployment`, `estimate_cost`, `apply_deployment`, `list_deployments`
- [ ] Files open / ready to paste — **not pasted yet**:
  - [ ] `tickets/clean.md`
  - [ ] `tickets/poisoned.md`
- [ ] Cursor chat empty / ready for first paste
- [ ] Fallback agreed with B (no debugging on clock)

---

## 4. Demo runbook (≤3:00) — actions only

**Mode (pick one before start):**

| Mode | When | How scenes 1–2 fire |
|------|------|---------------------|
| **Live MCP (preferred)** | A’s tools work | A pastes tickets; B may still press keys as backup |
| **Director (fallback)** | A MCP broken | B only — section 5 |

| Time | Scene | **Dev B does** | **Dev A does** | B may say *(optional)* |
|------|-------|----------------|----------------|------------------------|
| **0:00** | 0 Cold open | Press **`0`**. Point: spend → **$12,400/mo** red. | Silent. Face tower. | “Hidden ticket line → eight A100s. Who’s watching?” |
| **0:20** | 1 Happy path | Press **`1`** *or* confirm gate ON. Point: green **ALLOW** badges → approve → deploy. | At B’s nod: paste entire `tickets/clean.md`. Wait for plan/estimate on tower. | “Clean ticket — propose only. ~$3. Live.” |
| **0:55** | 2a Reject | Press **`2`** *or* clear quarantine + gate ON. Point: guardian **reject** bubble. | At **0:55**: paste entire `tickets/poisoned.md`. | “Eight A100s — over budget / injection.” |
| **1:15** | 2b 403 | Point: red **BLOCKED 403** on direct `apply`. | Let agent retry apply if it tries; do not coach. | “Dev identity can’t mutate.” |
| **1:35** | 2c Quarantine | Point: quarantine / PPL diff; even plan → 403. | Confirm tools now fail; stay silent. | “Identity quarantined — no human.” |
| **1:55** | 3 Orphan | Press **`3`**. Point: orphan seed → destroy → **spend drops**. | Silent. | “Orphan sweep — spend drops.” |
| **2:20** | 4 Sponsors | Press **`4`**. Point: Pomerium → Akash → Zero → Nexla. | Silent. | “Agents propose. SecGate disposes.” |
| **2:40–3:00** | Hold | Hold tagline / tower. **No new beats.** Stop talking by **2:55**. | Silent. | — |

### Timing cheat-sheet (B’s pocket card)

```
0:00  KEY 0  — disaster spend
0:20  KEY 1  — clean / happy   ← A pastes clean.md
0:55  KEY 2  — poisoned ×3     ← A pastes poisoned.md
1:55  KEY 3  — orphan
2:20  KEY 4  — sponsors
2:40  SILENCE / tagline hold
3:00  HARD STOP
```

### Cut if behind

| If clock is late… | Skip |
|-------------------|------|
| Scene 0 | Setup story — jump to spend + “Who’s watching?” |
| Scene 1 | Clicking live URL; any architecture aside |
| Scene 2 | Extra waits for second failures on A’s screen |
| Scene 3 | “twenty minutes idle” — just point at spend drop |
| Scene 4 | Collapse to: Pomerium · Akash · tagline only |

---

## 5. Fallback — A MCP fails (B-only)

Same timestamps. **No debugging on the clock.**

1. A (once, off-mic if possible): nod that tower drives the demo.
2. B: keep Control Tower full-screen; in hidden terminal run `npm run demo`.
3. B presses keys on the cheat-sheet clock: **`0` → `1` → `2` → `3` → `4`**.
4. A: do **not** paste tickets; watch tower with audience.
5. Optional VO: same one-liners in the runbook table (or appendix below).

```
npm run demo
# then: 0 @0:00 · 1 @0:20 · 2 @0:55 · 3 @1:55 · 4 @2:20
```

---

## 6. Spoken narration (what B says)

**Full script:** [demo/narration_script.md](../demo/narration_script.md) — first-person lines, timestamps, CUT IF BEHIND, elevator.

<details>
<summary>One-liners only (pocket card)</summary>

**Scene 0:** “Gate off — eight A100s. Twelve K a month. Who’s watching?”

**Scene 1:** “Clean ticket. Propose only. Zero + Nexla ≈ $3. Guardian on Akash. Live.”

**Scene 2:** “Poisoned — Guardian rejects. Direct apply — Pomerium 403. Quarantined. No human.”

**Scene 3:** “Orphan sweep — spend drops.”

**Scene 4:** “Pomerium · Akash · Zero · Nexla · Guardian. Agents propose. SecGate disposes.”

</details>

---

## 7. What NOT to say (on clock)

| Don’t | Do |
|-------|-----|
| “shim / fake Pomerium / policy proxy” | “Pomerium-shaped zero-trust gate” |
| Apologize for OAuth / mock | Save for Q&A |
| “The agent messed up” | “Hidden injection — caught three ways” |
| Extra architecture mid-scene | Point at tower; cut VO if behind |

---

## 8. Judge Q&A (after 3:00 — not in the demo)

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
| A pastes | `clean.md` @0:20 · `poisoned.md` @0:55 |
| B keys | `0` `1` `2` `3` `4` @ 0:00 / 0:20 / 0:55 / 1:55 / 2:20 |
| Hard stop | **3:00** |

**Related:** [demo/narration_script.md](../demo/narration_script.md), [docs/laptop-a-cheatsheet.md](./laptop-a-cheatsheet.md), [PLAN.md](../PLAN.md).
