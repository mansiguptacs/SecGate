# Audit Log (Control Tower)

Dense chronological trail under the visual **Timeline**. Presenters click sponsor links during the 3‑minute demo without leaving the Control Tower story.

## How to open

1. Start the stack: `npm run start:phase2` (or `start:phase3` with Akash).
2. Open **http://127.0.0.1:3100/** — Control Tower.
3. Scroll just below **Timeline** to the **Audit Log** panel.
4. Policy deep-link: **http://127.0.0.1:3100/admin/policy** (label **View policy**).

Filter with the sponsor chips (All / Pomerium / Zero / Nexla / Akash / Guardian). The rail auto-scrolls as new rows arrive.

## What each link opens

| Label | Opens | Notes |
| --- | --- | --- |
| **View policy** | `/admin/policy` | Live Pomerium PPL snippet (quarantine deny rules appear after scene 2). |
| **Akash console** | `https://console.akash.network` (or deployment deep-link when `dseq` known) | Override with `AKASH_CONSOLE_URL`. |
| **Live deployment** | Lease / ingress URL from apply | Only when the URL is a public `http(s)` host (not `*.local`). |
| **Nexla budget tool** | `https://dataops.nexla.io` (or MCP host / Studio URL) | Override with `NEXLA_CONSOLE_URL`; derived from `NEXLA_MCP_URL` when set. |
| **Zero.xyz** | `https://www.zero.xyz` | Override with `ZERO_CONSOLE_URL`. |
| **Control Tower** | Dashboard `/` | Guardian / scene bookends. |

## Sample log lines (demo narration)

```
15:02:11  system     scene start           tickets/clean.md              OK       View policy · Nexla budget tool · Zero.xyz · Akash console
15:02:14  dev-agent  plan                  staging-api                   ALLOW    View policy
15:02:15  guardian   budget fetch          prop-a1b2c3d4                 OK       Nexla budget tool
15:02:15  guardian   pricing               staging-api · $3/mo           OK       Zero.xyz
15:02:16  guardian   approve               staging-api (prop-…)          ALLOW    Control Tower · Nexla · Zero
15:02:17  guardian   apply ALLOW           staging-api (dep-…)           ALLOW    Live deployment · Akash console · View policy
15:02:40  guardian   reject                load-test-warm-pool           REJECTED Control Tower · Nexla · Zero
15:02:42  dev-agent  apply BLOCKED         apply_deployment              BLOCKED  View policy
15:02:45  guardian   quarantine            alice@example.com             BLOCKED  View policy · Control Tower
15:03:10  guardian   destroy               dep-orphan                    DESTROYED Akash console · Control Tower
```

## Env vars for console URLs

| Variable | Default | Purpose |
| --- | --- | --- |
| `AKASH_CONSOLE_URL` | `https://console.akash.network` | Akash Console / deployment UI |
| `NEXLA_CONSOLE_URL` | from `NEXLA_MCP_URL` host, else `https://dataops.nexla.io` | Nexla Studio / DataOps |
| `NEXLA_MCP_URL` | (from `.env`) | Used to infer Nexla console host |
| `ZERO_CONSOLE_URL` | `https://www.zero.xyz` | Zero pricing / device dashboard |
| `SECGATE_POLICY_VIEW_URL` | `http://127.0.0.1:$SECGATE_PORT/admin/policy` | Pomerium PPL viewer |
| `SECGATE_PORT` | `3100` | Dashboard + policy viewer origin |
| `SECGATE_GATEWAY_URL` | `http://127.0.0.1:3200` | Policy JSON source for the viewer |

## 3‑minute demo tips

- **Scene 0** — Point Audit Log at `apply ALLOW (gate off)` + **Akash console**.
- **Scene 1** — Click **Live deployment**, then **Nexla budget tool** / **Zero.xyz** on the approve row.
- **Scene 2** — Click **View policy** after quarantine to show rewritten PPL.
- **Scene 3** — Highlight `destroy` / `DESTROYED` on the orphan.
- **Scene 4** — Chip-filter by sponsor while narrating each beat.

Timeline stays visual and curated; Audit Log is the clickable evidence trail.
