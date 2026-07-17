#!/usr/bin/env bash
# Resilient Cloudflare quick tunnel → SecGate gateway (:3200).
# Hostname changes each time cloudflared restarts — see URL file / log.
set -uo pipefail

PORT="${SECGATE_GATEWAY_PORT:-3200}"
TARGET="http://127.0.0.1:${PORT}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="${SECGATE_TUNNEL_LOG_DIR:-$ROOT/.secgate-logs}"
DATA_DIR="${SECGATE_DATA_DIR:-$ROOT/data}"
mkdir -p "$LOG_DIR" "$DATA_DIR"
LOG="$LOG_DIR/gateway-tunnel.log"
URL_FILE="$LOG_DIR/gateway-tunnel-url.txt"
DATA_URL_FILE="${SECGATE_TUNNEL_URL_FILE:-$DATA_DIR/tunnel-url.txt}"
PID_FILE="$LOG_DIR/gateway-tunnel.pid"
CF_PID_FILE="$LOG_DIR/cloudflared.pid"

echo $$ > "$PID_FILE"
{
  echo "[keep-gateway-tunnel] pid=$$ target=${TARGET}"
  echo "[keep-gateway-tunnel] log=${LOG}"
  echo "[keep-gateway-tunnel] url file=${URL_FILE}"
} | tee -a "$LOG"

# Ignore SIGTERM from sibling scripts once; still allow hard kill
trap 'echo "[keep-gateway-tunnel] got signal; shutting down" | tee -a "$LOG"; [ -f "$CF_PID_FILE" ] && kill "$(cat "$CF_PID_FILE")" 2>/dev/null; exit 0' INT TERM

backoff=2
while true; do
  echo "[keep-gateway-tunnel] $(date -u +%Y-%m-%dT%H:%M:%SZ) starting cloudflared → ${TARGET}" | tee -a "$LOG"
  cloudflared tunnel --url "$TARGET" >>"$LOG" 2>&1 &
  cf_pid=$!
  echo "$cf_pid" > "$CF_PID_FILE"
  echo "[keep-gateway-tunnel] cloudflared pid=${cf_pid}" | tee -a "$LOG"

  for _ in $(seq 1 90); do
    if ! kill -0 "$cf_pid" 2>/dev/null; then
      break
    fi
    url="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" | tail -1 || true)"
    if [ -n "$url" ]; then
      prev="$(cat "$URL_FILE" 2>/dev/null || true)"
      if [ "$url" != "$prev" ]; then
        echo "$url" > "$URL_FILE"
        echo "$url" > "$DATA_URL_FILE"
        echo "[keep-gateway-tunnel] PUBLIC_URL=${url}" | tee -a "$LOG"
      fi
      break
    fi
    sleep 1
  done

  wait "$cf_pid" 2>/dev/null
  ec=$?
  echo "[keep-gateway-tunnel] $(date -u +%Y-%m-%dT%H:%M:%SZ) cloudflared exited code=${ec}; restarting in ${backoff}s" | tee -a "$LOG"
  sleep "$backoff"
  if [ "$backoff" -lt 30 ]; then
    backoff=$((backoff * 2))
  fi
done
