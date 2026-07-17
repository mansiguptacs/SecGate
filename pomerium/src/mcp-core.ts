/**
 * Shared MCP JSON-RPC handling for HTTP (/mcp) and stdio transports.
 * Enforces Pomerium policy, then proxies to upstream REST tools.
 */
import type { PolicyEngine } from "./policy";

export const TOOL_DEFS = [
  {
    name: "plan_deployment",
    description:
      "Propose an infra deployment (name, gpu, gpuCount, image, tags). Dev identity OK.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        gpu: { type: "string", description: "none | a100 | ..." },
        gpuCount: { type: "number" },
        image: { type: "string" },
        tags: { type: "object" },
      },
      required: ["name"],
    },
  },
  {
    name: "estimate_cost",
    description: "Estimate monthly cost for a planId; creates a pending proposal.",
    inputSchema: {
      type: "object",
      properties: {
        planId: { type: "string" },
        name: { type: "string" },
        gpu: { type: "string" },
        gpuCount: { type: "number" },
      },
    },
  },
  {
    name: "apply_deployment",
    description:
      "Apply an approved proposal. Guardian-only — dev identity gets 403 from the gate.",
    inputSchema: {
      type: "object",
      properties: {
        proposalId: { type: "string" },
        planId: { type: "string" },
      },
    },
  },
  {
    name: "destroy_deployment",
    description: "Destroy a running deployment by id. Guardian-only.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        deploymentId: { type: "string" },
      },
    },
  },
  {
    name: "list_deployments",
    description: "List running / known deployments.",
    inputSchema: { type: "object", properties: {} },
  },
] as const;

export type McpJsonRpcRequest = {
  jsonrpc?: string;
  id?: unknown;
  method?: string;
  params?: {
    name?: string;
    arguments?: Record<string, unknown>;
    protocolVersion?: string;
  };
};

export type McpJsonRpcResponse = {
  jsonrpc: "2.0";
  id: unknown;
  result?: unknown;
  error?: { code: number; message: string };
};

export type EmitAudit = (event: {
  kind: string;
  actor: string;
  message: string;
  detail?: Record<string, unknown>;
  sponsor?: string;
  title?: string;
  severity?: string;
  action?: string;
  resource?: string;
  result?: string;
}) => Promise<void>;

function isMutateTool(tool: string): boolean {
  return tool === "apply_deployment" || tool === "destroy_deployment";
}

/**
 * Handle one MCP JSON-RPC request. Returns null for notifications (no response).
 */
export async function handleMcpJsonRpc(
  body: McpJsonRpcRequest,
  opts: {
    engine: PolicyEngine;
    upstream: string;
    authorization?: string;
    emitAudit: EmitAudit;
  }
): Promise<McpJsonRpcResponse | null> {
  const id = body.id ?? 1;
  const method = String(body.method ?? "");

  if (method.startsWith("notifications/")) {
    return null;
  }

  if (method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: {
          name: "secgate",
          version: "0.2.0",
          title: "SecGate infra tools (identity-aware gate)",
        },
      },
    };
  }

  if (method === "ping") {
    return { jsonrpc: "2.0", id, result: {} };
  }

  if (method === "tools/list") {
    return {
      jsonrpc: "2.0",
      id,
      result: { tools: TOOL_DEFS },
    };
  }

  if (method === "tools/call") {
    const tool = String(body.params?.name ?? "");
    const args = (body.params?.arguments ?? {}) as Record<string, unknown>;
    if (!TOOL_DEFS.some((t) => t.name === tool)) {
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Unknown tool: ${tool}` },
      };
    }

    const decision = opts.engine.authorize(opts.authorization, tool);

    if (!decision.ok) {
      const actor = decision.identity?.id ?? "anonymous";
      await opts.emitAudit({
        kind: "blocked",
        actor,
        message: `${tool} BLOCKED 403 — ${decision.message}`,
        sponsor: "pomerium",
        title: `${tool} BLOCKED`,
        severity: "block",
        action: isMutateTool(tool) ? "apply BLOCKED" : "plan",
        resource: tool,
        result: "BLOCKED",
        detail: {
          tool,
          code: decision.code,
          via: "mcp",
          email: decision.identity?.email,
        },
      });
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                ok: false,
                error: decision.message,
                code: decision.code,
                tool,
                httpStatus: decision.status,
              }),
            },
          ],
          isError: true,
        },
      };
    }

    const identity = decision.identity!;
    try {
      const methodHttp = tool === "list_deployments" ? "GET" : "POST";
      const path =
        tool === "list_deployments" ? "/list_deployments" : `/${tool}`;
      const headers: Record<string, string> = {
        "content-type": "application/json",
        "x-secgate-actor": identity.id,
        "x-secgate-email": identity.email,
        "x-secgate-via": "pomerium-mcp",
      };
      const init: RequestInit = { method: methodHttp, headers };
      if (methodHttp === "POST") {
        const restBody = { ...args };
        if (tool === "destroy_deployment" && !restBody.id && restBody.deploymentId) {
          restBody.id = restBody.deploymentId;
        }
        init.body = JSON.stringify(restBody);
      }
      const upstreamRes = await fetch(`${opts.upstream}${path}`, init);
      const text = await upstreamRes.text();
      let parsed: unknown = text;
      try {
        parsed = JSON.parse(text);
      } catch {
        /* keep text */
      }
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [
            {
              type: "text",
              text:
                typeof parsed === "string"
                  ? parsed
                  : JSON.stringify(parsed, null, 2),
            },
          ],
          isError: !upstreamRes.ok,
        },
      };
    } catch (err) {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [
            {
              type: "text",
              text: `Upstream error: ${(err as Error).message}`,
            },
          ],
          isError: true,
        },
      };
    }
  }

  return {
    jsonrpc: "2.0",
    id,
    error: { code: -32601, message: `Method not found: ${method}` },
  };
}
