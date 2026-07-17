# Akash backend (Phase 3)

SecGate deploys a tiny **nginx:alpine** workload via SDL (`infra-mcp/akash/staging-api.sdl.yml`). Mock remains the default.

## Enable

```bash
# Dry-run (no credentials) — realistic lease IDs + ingress URLs for demos
BACKEND=akash npm run start:phase3
# or: BACKEND=akash npm run start:phase2

# Live Console API (when Dev 2 hands over the key)
export BACKEND=akash
export AKASH_API_KEY="ac.sk...."   # from console.akash.network → Settings → API Keys
npm run start:phase3
```

Guardian still calls `apply_deployment` / `destroy_deployment` through the **Pomerium shim (:3200)** so identity policy is unchanged.

## Env vars (Dev 2 → Dev 1)

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `BACKEND` or `SECGATE_BACKEND` | to enable | `mock` | `mock` \| `akash` |
| `AKASH_API_KEY` | for live | — | Console managed-wallet API key (`x-api-key`) |
| `AKASH_CONSOLE_API_KEY` | alias | — | Same as `AKASH_API_KEY` |
| `AKASH_CONSOLE_API_URL` | no | `https://console-api.akash.network` | API base |
| `AKASH_DEPOSIT_USD` | no | `0.5` | Escrow deposit (USD, min 0.5) |
| `AKASH_DRY_RUN` | no | auto | `1` forces dry-run even if key is set |
| `AKASH_SDL_PATH` | no | packaged SDL | Override SDL YAML path |
| `AKASH_BID_POLL_MS` | no | `3000` | Bid poll interval (live) |
| `AKASH_BID_MAX_ATTEMPTS` | no | `20` | Bid poll attempts (~60s) |
| `AKASH_URI_POLL_MS` | no | `3000` | URI poll after lease |
| `AKASH_URI_MAX_ATTEMPTS` | no | `20` | URI poll attempts |

**Without credentials:** `BACKEND=akash` automatically uses **dry-run** — apply returns `akash-dseq-*` lease IDs and `https://<name>-<dseq>.ingress.akash.network` URLs; destroy marks local state destroyed.

**With `AKASH_API_KEY`:** create deployment → wait bids → create lease → poll for URI → return live URL; destroy calls `DELETE /v1/deployments/{dseq}`.

## Tests

```bash
npm run test:phase1   # mock backend (default)
npm run test:phase2   # Pomerium shim
npm run test:phase3   # Akash dry-run path
```

## Gaps / not in Phase 3

- ~~Zero.xyz live pricing~~ → Phase 4 (`docs/phase4-sponsors.md`)
- ~~Nexla budgets~~ → Phase 4 (`data/budget.json` fallback)
- GPU SDLs / marketplace A100 bids (intentionally blocked by guardian before apply)
- Wallet mnemonic / `akash` CLI path (Console API only for live)
