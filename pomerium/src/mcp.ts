/**
 * Cursor-compatible MCP JSON-RPC (streamable HTTP) on the Pomerium policy shim.
 *
 * Cursor expects initialize / tools/list / tools/call — not our REST /plan_deployment
 * routes. This adapter enforces the same identity policy, then calls upstream HTTP tools.
 */
import type express from "express";
import type { PolicyEngine } from "./policy";
import {
  TOOL_DEFS,
  handleMcpJsonRpc,
  type EmitAudit,
  type McpJsonRpcRequest,
} from "./mcp-core";

export { TOOL_DEFS } from "./mcp-core";

export function mountMcpRoutes(
  app: express.Express,
  engine: PolicyEngine,
  upstream: string,
  emitAudit: EmitAudit
): void {
  const handler = async (req: express.Request, res: express.Response) => {
    const body = (req.body ?? {}) as McpJsonRpcRequest;
    const method = String(body.method ?? "");

    if (method.startsWith("notifications/")) {
      res.status(202).end();
      return;
    }

    const response = await handleMcpJsonRpc(body, {
      engine,
      upstream,
      authorization: req.header("authorization") ?? undefined,
      emitAudit,
    });

    if (!response) {
      res.status(202).end();
      return;
    }
    res.json(response);
  };

  // Streamable HTTP: POST JSON-RPC to /mcp
  app.post(["/mcp", "/mcp/"], (req, res) => {
    void handler(req, res);
  });

  // SSE probe — return a clear hint (Cursor previously got bare 404)
  app.get(["/sse", "/mcp/sse"], (_req, res) => {
    res.status(405).json({
      ok: false,
      error:
        "SSE not used for Cursor demo. Prefer stdio MCP (docs/cursor-mcp.json). HTTP: POST http://127.0.0.1:3200/mcp with Bearer token.",
    });
  });

  app.get(["/mcp", "/mcp/"], (_req, res) => {
    res.json({
      ok: true,
      transport: "streamable-http",
      endpoint: "POST /mcp",
      auth: "Authorization: Bearer dev-agent-token-PHASE2",
      tools: TOOL_DEFS.map((t) => t.name),
      note: "For single-machine Cursor, prefer stdio config in docs/cursor-mcp.json",
    });
  });
}
