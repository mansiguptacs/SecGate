#!/usr/bin/env bash
# Durable SecGate stack for demo: infra-mcp (:3100) + gateway (:3200) + guardian,
# with a watchdog that restarts anything that dies.
#
# Usage: bash scripts/start-durable.sh
# Logs:  /tmp/secgate-*.log and $ROOT/.secgate-logs/
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="${SECGATE_LOG_DIR:-$ROOT/.secgate-logs}"
WATCHDOG_LOG="$LOG_DIR/watchdog.log"
WATCHDOG_PID_FILE="$LOG_DIR/watchdog.pid"
MCP_PORT="${SECGATE_PORT:-3100}"
GATEWAY_PORT="${SECGATE_GATEWAY_PORT:-3200}"
TOKEN="${SECGATE_DEV_TOKEN:-dev-agent-token-PHASE2}"
INTERVAL="${SECGATE_WATCHDOG_INTERVAL:-5}"

mkdir -p "$LOG_DIR"

# shellcheck disable=SC1091
set -a
[ -f "$ROOT/.env" ] && . "$ROOT/.env"
set +a

export SECGATE_GATEWAY_HOST="${SECGATE_GATEWAY_HOST:-0.0.0.0}"
export SECGATE_GATEWAY_PORT="$GATEWAY_PORT"
export SECGATE_PORT="$MCP_PORT"
export BACKEND="${BACKEND:-${SECGATE_BACKEND:-akash}}"
export SECGATE_DETACH_KEEP=1

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

ensure_built() {
  if [ ! -f "$ROOT/pomerium/dist/shim.js" ] || [ ! -f "$ROOT/pomerium/dist/mcp-stdio.js" ]; then
    echo "[durable] building workspaces…"
    (cd "$ROOT" && npm run build)
  fi
}

start_stack() {
  echo "[durable] starting phase2 stack (SECGATE_DETACH_KEEP=1)…"
  (
    cd "$ROOT"
    SECGATE_DETACH_KEEP=1 nohup node scripts/start-phase2.js \
      >>"$LOG_DIR/phase2.nohup.out" 2>&1 &
    echo $! >"$LOG_DIR/phase2.pid"
  )
  for i in $(seq 1 45); do
    if gateway_ok && mcp_ok; then
      echo "[durable] stack healthy after ${i}s (:${MCP_PORT} + :${GATEWAY_PORT})"
      return 0
    fi
    sleep 1
  done
  echo "[durable] WARNING: stack not healthy yet — see /tmp/secgate-*.log and ${LOG_DIR}/phase2.nohup.out" >&2
  return 1
}

ensure_built

if gateway_ok && mcp_ok; then
  echo "[durable] stack already healthy"
else
  start_stack || true
fi

# Replace previous watchdog
if [ -f "$WATCHDOG_PID_FILE" ]; then
  old="$(cat "$WATCHDOG_PID_FILE" 2>/dev/null || true)"
  if [ -n "${old:-}" ] && kill -0 "$old" 2>/dev/null; then
    kill "$old" 2>/dev/null || true
    sleep 0.3
  fi
fi

nohup bash "$ROOT/scripts/watchdog-gateway.sh" >>"$WATCHDOG_LOG" 2>&1 &
echo $! >"$WATCHDOG_PID_FILE"
disown 2>/dev/null || true

echo ""
echo "========== SecGate durable stack =========="
echo "  Control Tower  http://127.0.0.1:${MCP_PORT}/"
echo "  HTTP gateway   http://127.0.0.1:${GATEWAY_PORT}/mcp  (ticket-driver)"
echo "  Watchdog pid   $(cat "$WATCHDOG_PID_FILE")  log=${WATCHDOG_LOG}"
echo "  Cursor MCP     paste stdio block from docs/cursor-mcp.json"
echo "==========================================="
