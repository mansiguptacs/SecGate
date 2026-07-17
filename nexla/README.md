# Nexla MCP budget shim (demo stand-in)

Local JSON-RPC MCP endpoint that exposes **`get_team_budget`** in the shape
guardian expects. Control Tower shows the **Nexla** badge while waiting on
real booth / MCP Studio credentials.

```bash
npm run build -w @secgate/nexla
npm run start:nexla
# → http://127.0.0.1:3300/mcp
#    Authorization: Bearer nxl_sk_secgate_demo_shim
```

`npm run start:phase2` starts this automatically when `NEXLA_USE_SHIM=1` or
`NEXLA_MCP_URL` is unset / localhost.

## Swap for real Nexla

```bash
NEXLA_USE_SHIM=0
NEXLA_MCP_URL=https://api-genai.nexla.io/mcp/service_key/<server_key>
NEXLA_SERVICE_KEY=nxl_sk_....
```

See [docs/phase4-sponsors.md](../docs/phase4-sponsors.md).
