# Screen Recording Setup — Laptop A

## Software

- **OBS Studio** (recommended) or **Loom** (fallback)
- Resolution: **1920×1080**, framerate: **30 fps**
- Output: MP4 (H.264), bitrate ~6 Mbps
- Dark theme on all windows — no light backgrounds on camera

## OBS Scene Layout

### Primary: "Control Tower" — captured on Laptop B
*(Laptop B runs the full stack. These notes describe what the final recording should show.)*

- Full-screen browser at `http://localhost:3100` (Control Tower dashboard)
- Browser zoom: **125%**
- No terminal, dock, or taskbar visible

### PiP: "Agent Chat" — captured on Laptop A (this machine)
Visible during:
- **Scene 1** (happy path) — show agent calling `plan_deployment`
- **Scene 2 beat 1** (attack) — show agent reading poisoned ticket and proposing

**Layout:** bottom-right corner, ~300×200 px overlay

---

## Laptop A MCP Connection

### Step 1 — Get tunnel URL from Dev 1

Dev 1 runs one of (on Laptop B after `npm run start:phase2`):
```bash
# Option A (preferred)
ssh -R 0:127.0.0.1:3200 ssh.pom.run
# Option B — cloudflared
cloudflared tunnel --url http://127.0.0.1:3200
# Option C — ngrok
ngrok http 3200
```
Copy the printed HTTPS URL — that is `SECGATE_GATEWAY_URL` for Laptop A.

### Step 2 — Configure MCP in Cursor / Claude Code

Add to MCP server config:
```json
{
  "mcpServers": {
    "secgate": {
      "url": "https://REPLACE_WITH_TUNNEL_URL",
      "transport": "streamable-http",
      "headers": {
        "Authorization": "Bearer dev-agent-token-PHASE2"
      }
    }
  }
}
```

**Dev identity token:** `dev-agent-token-PHASE2`  
**Do NOT** use the guardian token (`guardian-agent-token-PHASE2`) on Laptop A.

### Step 3 — Smoke test (from Laptop A terminal)

```bash
export SECGATE=https://REPLACE_WITH_TUNNEL_URL
export TOK=dev-agent-token-PHASE2

# Should succeed (200):
curl -s "$SECGATE/plan_deployment" \
  -H "authorization: Bearer $TOK" -H "content-type: application/json" \
  -d '{"name":"staging-api","gpu":"none","gpuCount":1}'

# Should return 403:
curl -s -o /dev/null -w '%{http_code}\n' "$SECGATE/apply_deployment" \
  -H "authorization: Bearer $TOK" -H "content-type: application/json" \
  -d '{"proposalId":"prop-test"}'
```

---

## Recording Run Order

Record in this order to handle Akash marketplace latency:

| Step | What | When |
|------|------|------|
| **Pre-seed orphan** | Dev 1 runs `npm run demo -- 3` on Laptop B to test orphan sweep | Before recording |
| **Scene 1 first** | Record happy path with real Akash deploy separately | ~3:20 PM |
| **Full run (0→4)** | `npm run demo` on Laptop B, type keys 0–4 in sequence | ~3:50 PM |
| **Splice** | Replace Scene 1 deploy wait with pre-recorded Akash segment if > 15 s | In edit |

---

## Pre-Recording Checklist

- [ ] Laptop B running: `npm run start:phase2` (gateway :3200, Control Tower :3100)
- [ ] Tunnel URL received from Dev 1 and plugged into Cursor MCP config
- [ ] Smoke test: `plan_deployment` → 200, `apply_deployment` → 403
- [ ] Smoke test visible on Laptop B Control Tower (ALLOW + BLOCKED badges)
- [ ] Poisoned ticket loaded but **NOT yet pasted** into Cursor
- [ ] OBS recording to local disk (not streaming)
- [ ] Notifications and phone silenced
- [ ] Laptop A power plugged in
- [ ] Laptop B Control Tower full-screen, 125% zoom, dark mode

---

## Devpost Video Constraints

- Max length: **3 minutes** (aim for 2:55)
- Format: MP4, typically < 200 MB (confirm Devpost limits at submission)
- Export from OBS or DaVinci Resolve (free)
- Optional: lower-thirds naming sponsors in Scene 4
