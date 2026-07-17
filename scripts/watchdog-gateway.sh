#!/usr/bin/env bash
# Watchdog: restart SecGate phase2 if :3100 or :3200 go down.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="${SECGATE_LOG_DIR:-$ROOT/.secgate-logs}"
MCP_PORT="${SECGATE_PORT:-3100}"
GATEWAY_PORT="${SECGATE_GATEWAY_PORT:-3200}"
TOKEN="${SECGATE_DEV_TOKEN:-dev-agent-token-PHASE2}"
INTERVAL="${SECGATE_WATCHDOG_INTERVAL:-5}"

mkdir -p "$LOG_DIR"

gateway_ok() {
  local code
  code="$(curl -sS -o /dev/null -w '%{http_code}' -m 2 \
    -H "Authorization: Bearer ${TOKEN}" \
    "http://127.0.0.1:${GATEWAY_PORT}/health" 2>/dev/null || true)"
  [ "$code" = "200" ]
}

mcp_ok() {
  local code
  code="$(curl -sS -o /dev/null -w '%{http_code}' -m 2 \
    "http://127.0.0.1:${MCP_PORT}/" 2>/dev/null || true)"
  [ -n "$code" ] && [ "$code" != "000" ]
}

start_stack() {
  cd "$ROOT"
  # shellcheck disable=SC1091
  set -a
  [ -f "$ROOT/.env" ] && . "$ROOT/.env"
  set +a
  export SECGATE_DETACH_KEEP=1
  export SECGATE_GATEWAY_HOST="${SECGATE_GATEWAY_HOST:-0.0.0.0}"
  export SECGATE_GATEWAY_PORT="$GATEWAY_PORT"
  export SECGATE_PORT="$MCP_PORT"
  export BACKEND="${BACKEND:-${SECGATE_BACKEND:-akash}}"
  nohup node scripts/start-phase2.js >>"$LOG_DIR/phase2.nohup.out" 2>&1 &
  echo $! >"$LOG_DIR/phase2.pid"
  for i in $(seq 1 40); do
    if mcp_ok && gateway_ok; then
      echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] restarted OK after ${i}s"
      return 0
    fi
    sleep 1
  done
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] restart failed — see /tmp/secgate-*.log"
  return 1
}

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] watchdog started interval=${INTERVAL}s"

while true; do
  if ! mcp_ok || ! gateway_ok; then
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] stack down — restarting"
    for p in "$MCP_PORT" "$GATEWAY_PORT"; do
      pids="$(lsof -nP -tiTCP:"$p" -sTCP:LISTEN 2>/dev/null || true)"
      if [ -n "${pids:-}" ]; then
        # shellcheck disable=SC2086
        kill $pids 2>/dev/null || true
      fi
    done
    # Also clear guardian/npm leftovers listening nowhere — best effort
    sleep 1
    start_stack || true
  fi
  sleep "$INTERVAL"
done
