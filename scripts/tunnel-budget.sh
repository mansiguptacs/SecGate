#!/usr/bin/env bash
# Expose SecGate GET /budget over a temporary Cloudflare quick tunnel
# for Nexla Studio "REST / API source" onboarding.
set -euo pipefail

PORT="${SECGATE_PORT:-3100}"
URL="http://127.0.0.1:${PORT}/budget?team=platform-eng"

echo "[tunnel-budget] Checking local budget API at ${URL}"
if ! curl -sf "$URL" >/dev/null; then
  echo "[tunnel-budget] ERROR: nothing answering on :${PORT}."
  echo "  Start the stack first:  npm run start:phase2"
  echo "  Or infra only:          npm run start -w infra-mcp"
  exit 1
fi

echo "[tunnel-budget] Local OK:"
curl -sS "$URL"
echo
echo
echo "[tunnel-budget] Starting cloudflared quick tunnel → http://127.0.0.1:${PORT}"
echo "[tunnel-budget] In Nexla Studio REST source use:"
echo "    Base URL  = https://<printed-host>"
echo "    Endpoint  = /budget?team=platform-eng"
echo "    Method    = GET"
echo "[tunnel-budget] Leave this process running while Nexla ingests."
echo

exec cloudflared tunnel --url "http://127.0.0.1:${PORT}"
