#!/usr/bin/env bash
# LAN-first SecGate gateway + stable tunnel backup (not Cloudflare quick tunnels).
#
# Primary:   http://<LAN_IP>:3200  (same Wi‑Fi)
# Backup:    named cloudflared / ngrok reserved domain / ssh -R / localtunnel
# Last resort only: npm run tunnel:gateway (ephemeral trycloudflare hostname)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${SECGATE_GATEWAY_PORT:-3200}"
HOST="${SECGATE_GATEWAY_HOST:-0.0.0.0}"
TOKEN="${SECGATE_DEV_TOKEN:-dev-agent-token-PHASE2}"
DATA_DIR="${SECGATE_DATA_DIR:-$ROOT/data}"
LOG_DIR="${SECGATE_TUNNEL_LOG_DIR:-$ROOT/.secgate-logs}"
URL_FILE="${SECGATE_TUNNEL_URL_FILE:-$DATA_DIR/tunnel-url.txt}"
SUB_FILE="${SECGATE_TUNNEL_SUBDOMAIN_FILE:-$DATA_DIR/tunnel-subdomain.txt}"
LAN_FILE="${SECGATE_LAN_URL_FILE:-$DATA_DIR/lan-url.txt}"
PID_FILE="$LOG_DIR/stable-tunnel.pid"
LOG="$LOG_DIR/stable-tunnel.log"
KEEP_PID_FILE="$LOG_DIR/gateway-tunnel.pid"

mkdir -p "$DATA_DIR" "$LOG_DIR"

lan_ips() {
  local ips=""
  if command -v ipconfig >/dev/null 2>&1; then
    for iface in en0 en1 en2 en3 bridge0; do
      ip="$(ipconfig getifaddr "$iface" 2>/dev/null || true)"
      if [ -n "${ip:-}" ]; then
        ips="${ips}${ip}"$'\n'
      fi
    done
  fi
  if command -v ifconfig >/dev/null 2>&1; then
    ips="${ips}$(ifconfig 2>/dev/null | awk '/inet / && $2 != "127.0.0.1" {print $2}')"$'\n'
  fi
  printf '%s' "$ips" | awk 'NF && !seen[$0]++'
}

gateway_ok() {
  local base="$1"
  code="$(curl -sS -o /dev/null -w '%{http_code}' \
    -H "Authorization: Bearer ${TOKEN}" \
    --connect-timeout 2 \
    "${base}/health" 2>/dev/null || true)"
  [ "$code" = "200" ]
}

stop_ephemeral_keep_tunnel() {
  # Disabled: Laptop A path uses keep-gateway-tunnel.sh (ephemeral quick tunnel).
  # Do not SIGTERM sibling cloudflared quick tunnels.
  return 0
  # Integrate cleanly with leftover keep-gateway-tunnel / quick cloudflared
  if [ -f "$KEEP_PID_FILE" ]; then
    old="$(cat "$KEEP_PID_FILE" 2>/dev/null || true)"
    if [ -n "${old:-}" ] && kill -0 "$old" 2>/dev/null; then
      echo "[stable-gateway] stopping leftover keep-gateway-tunnel pid=${old}"
      kill "$old" 2>/dev/null || true
      sleep 0.5
      kill -9 "$old" 2>/dev/null || true
    fi
    rm -f "$KEEP_PID_FILE"
  fi
  # Best-effort: stop orphan quick tunnels aimed at this gateway
  if command -v pgrep >/dev/null 2>&1; then
    while read -r pid; do
      [ -n "$pid" ] || continue
      cmd="$(ps -p "$pid" -o command= 2>/dev/null || true)"
      case "$cmd" in
        *cloudflared*tunnel*--url*"${PORT}"*|*"keep-gateway-tunnel"*)
          echo "[stable-gateway] stopping ephemeral tunnel pid=${pid}"
          kill "$pid" 2>/dev/null || true
          ;;
      esac
    done < <(pgrep -f 'cloudflared tunnel --url|keep-gateway-tunnel' 2>/dev/null || true)
  fi
}

ensure_phase2() {
  if gateway_ok "http://127.0.0.1:${PORT}"; then
    echo "[stable-gateway] phase2 gateway already healthy on :${PORT}"
    return 0
  fi
  echo "[stable-gateway] starting phase2 (gateway host=${HOST} port=${PORT})…"
  (
    cd "$ROOT"
    # shellcheck disable=SC1091
    set -a
    [ -f "$ROOT/.env" ] && . "$ROOT/.env"
    set +a
    export SECGATE_GATEWAY_HOST="$HOST"
    export SECGATE_GATEWAY_PORT="$PORT"
    nohup npm run start:phase2 >>"$LOG_DIR/phase2.nohup.out" 2>&1 &
    echo $! >"$LOG_DIR/phase2.pid"
  )
  for i in $(seq 1 40); do
    if gateway_ok "http://127.0.0.1:${PORT}"; then
      echo "[stable-gateway] phase2 ready after ${i}s"
      return 0
    fi
    sleep 1
  done
  echo "[stable-gateway] ERROR: gateway :${PORT} did not become healthy" >&2
  exit 1
}

print_lan() {
  local primary=""
  echo ""
  echo "========== PRIMARY (LAN — prefer this) =========="
  while read -r ip; do
    [ -n "$ip" ] || continue
    url="http://${ip}:${PORT}"
    if [ -z "$primary" ]; then
      primary="$url"
    fi
    if gateway_ok "$url"; then
      echo "  OK  ${url}   Bearer ${TOKEN}"
    else
      echo "  ??  ${url}   (curl failed from this host — check firewall / client isolation)"
    fi
  done < <(lan_ips)
  if [ -z "$primary" ]; then
    primary="http://<LAN_IP>:${PORT}"
    echo "  (no LAN IP detected — run: ipconfig getifaddr en0)"
  fi
  echo "$primary" >"$LAN_FILE"
  echo "================================================="
  echo ""
  echo "Cursor MCP (LAN):"
  cat <<EOF
{
  "mcpServers": {
    "secgate": {
      "url": "${primary}",
      "transport": "streamable-http",
      "headers": {
        "Authorization": "Bearer ${TOKEN}"
      }
    }
  }
}
EOF
  echo ""
}

pick_subdomain() {
  if [ -f "$SUB_FILE" ]; then
    tr -d '[:space:]' <"$SUB_FILE"
    return
  fi
  if [ -n "${SECGATE_LT_SUBDOMAIN:-}" ]; then
    echo "$SECGATE_LT_SUBDOMAIN"
    return
  fi
  echo "secgate-hack"
}

start_named_cloudflared() {
  if [ -n "${SECGATE_CF_TUNNEL_TOKEN:-}" ]; then
    echo "[stable-gateway] named Cloudflare tunnel (token)…"
    nohup cloudflared tunnel run --token "$SECGATE_CF_TUNNEL_TOKEN" \
      >>"$LOG" 2>&1 &
    echo $! >"$PID_FILE"
    return 0
  fi
  if [ -n "${SECGATE_CF_TUNNEL_NAME:-}" ] && [ -d "${HOME}/.cloudflared" ]; then
    echo "[stable-gateway] named Cloudflare tunnel: ${SECGATE_CF_TUNNEL_NAME}"
    nohup cloudflared tunnel run "$SECGATE_CF_TUNNEL_NAME" >>"$LOG" 2>&1 &
    echo $! >"$PID_FILE"
    if [ -n "${SECGATE_CF_TUNNEL_URL:-}" ]; then
      echo "$SECGATE_CF_TUNNEL_URL" >"$URL_FILE"
      echo "[stable-gateway] BACKUP_URL=${SECGATE_CF_TUNNEL_URL} (from SECGATE_CF_TUNNEL_URL)"
    fi
    return 0
  fi
  return 1
}

start_ngrok() {
  if ! command -v ngrok >/dev/null 2>&1; then
    return 1
  fi
  if [ -z "${SECGATE_NGROK_DOMAIN:-}" ]; then
    return 1
  fi
  echo "[stable-gateway] ngrok reserved domain ${SECGATE_NGROK_DOMAIN}…"
  nohup ngrok http --domain="$SECGATE_NGROK_DOMAIN" "$PORT" >>"$LOG" 2>&1 &
  echo $! >"$PID_FILE"
  url="https://${SECGATE_NGROK_DOMAIN}"
  echo "$url" >"$URL_FILE"
  echo "[stable-gateway] BACKUP_URL=${url}"
  return 0
}

start_ssh_r() {
  if [ -z "${SECGATE_SSH_TUNNEL_HOST:-}" ]; then
    return 1
  fi
  # Example: SECGATE_SSH_TUNNEL_HOST=user@jump SECGATE_SSH_TUNNEL_REMOTE=0.0.0.0:8443
  remote="${SECGATE_SSH_TUNNEL_REMOTE:-0.0.0.0:8443}"
  echo "[stable-gateway] ssh -R ${remote} → 127.0.0.1:${PORT} via ${SECGATE_SSH_TUNNEL_HOST}"
  nohup ssh -N -R "${remote}:127.0.0.1:${PORT}" "$SECGATE_SSH_TUNNEL_HOST" >>"$LOG" 2>&1 &
  echo $! >"$PID_FILE"
  if [ -n "${SECGATE_SSH_TUNNEL_URL:-}" ]; then
    echo "$SECGATE_SSH_TUNNEL_URL" >"$URL_FILE"
    echo "[stable-gateway] BACKUP_URL=${SECGATE_SSH_TUNNEL_URL}"
  else
    echo "[stable-gateway] ssh reverse tunnel up — set SECGATE_SSH_TUNNEL_URL to record public URL"
  fi
  return 0
}

extract_lt_url() {
  # localtunnel prints "your url is: https://….loca.lt"
  local line="$1"
  if [[ "$line" =~ https://[a-zA-Z0-9.-]+\.loca\.lt ]]; then
    echo "$line" | grep -oE 'https://[a-zA-Z0-9.-]+\.loca\.lt' | head -1
  fi
}

start_localtunnel() {
  local sub wanted url=""
  wanted="$(pick_subdomain)"
  echo "[stable-gateway] localtunnel subdomain=${wanted} → :${PORT}"

  # Prefer global lt if present; else npx
  local cmd=()
  if command -v lt >/dev/null 2>&1; then
    cmd=(lt --port "$PORT" --subdomain "$wanted")
  else
    cmd=(npx --yes localtunnel --port "$PORT" --subdomain "$wanted")
  fi

  launch_lt() {
    local sub="$1"
    : >"$LOG"
    # nohup + disown so the tunnel survives after this script exits
    if command -v lt >/dev/null 2>&1; then
      nohup lt --port "$PORT" --subdomain "$sub" >>"$LOG" 2>&1 &
    else
      nohup npx --yes localtunnel --port "$PORT" --subdomain "$sub" >>"$LOG" 2>&1 &
    fi
    local pid=$!
    disown "$pid" 2>/dev/null || true
    echo "$pid" >"$PID_FILE"
    echo "$pid"
  }

  wait_lt_url() {
    local pid="$1" max="${2:-30}" i url=""
    for i in $(seq 1 "$max"); do
      if ! kill -0 "$pid" 2>/dev/null; then
        # npx may spawn a child then exit — look for surviving localtunnel/node
        if pgrep -f "localtunnel|bin/lt" >/dev/null 2>&1; then
          url="$(grep -oE 'https://[a-zA-Z0-9.-]+\.loca\.lt' "$LOG" 2>/dev/null | head -1 || true)"
          [ -n "$url" ] && echo "$url" && return 0
        fi
        break
      fi
      url="$(grep -oE 'https://[a-zA-Z0-9.-]+\.loca\.lt' "$LOG" 2>/dev/null | head -1 || true)"
      if [ -n "$url" ]; then
        echo "$url"
        return 0
      fi
      sleep 0.4
    done
    return 1
  }

  lt_pid="$(launch_lt "$wanted")"
  url="$(wait_lt_url "$lt_pid" 25 || true)"

  if [ -z "$url" ]; then
    echo "[stable-gateway] subdomain '${wanted}' unavailable or lt failed; trying random secgate-* …"
    kill "$lt_pid" 2>/dev/null || true
    pkill -f "localtunnel.*${PORT}|lt --port ${PORT}" 2>/dev/null || true
    sleep 0.3
    # Persist a one-time random subdomain so restarts stay stable
    if [ ! -f "$SUB_FILE" ] || [ "$(tr -d '[:space:]' <"$SUB_FILE")" = "secgate-hack" ]; then
      rand="$(openssl rand -hex 3 2>/dev/null || echo "$(date +%s | tail -c 7)")"
      wanted="secgate-${rand}"
      echo "$wanted" >"$SUB_FILE"
      echo "[stable-gateway] saved subdomain → ${SUB_FILE}: ${wanted}"
    else
      wanted="$(tr -d '[:space:]' <"$SUB_FILE")"
    fi
    lt_pid="$(launch_lt "$wanted")"
    url="$(wait_lt_url "$lt_pid" 30 || true)"
  else
    # Remember successful preferred subdomain
    echo "$wanted" >"$SUB_FILE"
  fi

  if [ -n "$url" ]; then
    echo "$url" >"$URL_FILE"
    echo "[stable-gateway] BACKUP_URL=${url}  (saved ${URL_FILE})"
    return 0
  fi

  echo "[stable-gateway] WARNING: localtunnel did not print a URL — see ${LOG}" >&2
  return 1
}

# --- main ---
echo "[stable-gateway] root=${ROOT}"
stop_ephemeral_keep_tunnel
ensure_phase2
print_lan

echo "========== BACKUP (only if LAN blocked) =========="
if [ -f "$PID_FILE" ]; then
  old="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [ -n "${old:-}" ] && kill -0 "$old" 2>/dev/null; then
    echo "[stable-gateway] stable tunnel already running pid=${old}"
    if [ -f "$URL_FILE" ]; then
      echo "[stable-gateway] BACKUP_URL=$(cat "$URL_FILE")"
    fi
    exit 0
  fi
fi

if start_named_cloudflared; then
  :
elif start_ngrok; then
  :
elif start_ssh_r; then
  :
elif start_localtunnel; then
  :
else
  echo "[stable-gateway] no stable tunnel started."
  echo "  Set SECGATE_CF_TUNNEL_TOKEN / SECGATE_NGROK_DOMAIN / SECGATE_SSH_TUNNEL_HOST,"
  echo "  or install localtunnel. Ephemeral last resort: npm run tunnel:gateway"
fi

if [ -f "$URL_FILE" ]; then
  echo "Backup tunnel URL file: ${URL_FILE}"
  echo "  $(cat "$URL_FILE")"
fi
echo "=================================================="
echo ""
echo "Prefer LAN. Use tunnel backup only when venue Wi‑Fi has client isolation."
