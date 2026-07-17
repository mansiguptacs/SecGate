/**
 * Nexla-compatible MCP budget shim (demo stand-in).
 *
 * Serves the same JSON-RPC tools/call interface guardian expects for
 * get_team_budget until real Nexla booth credentials arrive.
 *
 * Label: Nexla MCP shim — swap for real ToolSet MCP URL + service key.
 *
 * Real swap later:
 *   NEXLA_MCP_URL=https://api-genai.nexla.io/mcp/service_key/<server_key>
 *   NEXLA_SERVICE_KEY=nxl_sk_....
 */

import http from "http";
import fs from "fs";
import path from "path";
import { URL } from "url";

const PORT = Number(process.env.NEXLA_SHIM_PORT ?? 3300);
const EXPECTED_KEY =
  process.env.NEXLA_SERVICE_KEY ??
  process.env.NEXLA_API_KEY ??
  "nxl_sk_secgate_demo_shim";
const TOOL_NAME = process.env.NEXLA_BUDGET_TOOL ?? "get_team_budget";
const DEFAULT_TEAM = process.env.NEXLA_TEAM ?? "platform-eng";

function budgetFilePath(): string {
  if (process.env.SECGATE_BUDGET_FILE) {
    return path.resolve(process.env.SECGATE_BUDGET_FILE);
  }
  const dataDir = process.env.SECGATE_DATA_DIR
    ? path.resolve(process.env.SECGATE_DATA_DIR)
    : path.resolve(__dirname, "../../data");
  return path.join(dataDir, "budget.json");
}

export interface BudgetPayload {
  team: string;
  monthly_budget_usd: number;
  spent_usd: number;
}

export function loadBudgetPayload(teamHint?: string): BudgetPayload {
  const file = budgetFilePath();
  const envCap = Number(process.env.SECGATE_BUDGET_USD ?? 500);
  let monthly = envCap;
  let spent = 0;
  let team = teamHint?.trim() || DEFAULT_TEAM;
  try {
    if (fs.existsSync(file)) {
      const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<
        string,
        unknown
      >;
      monthly = Number(raw.monthly_budget_usd ?? raw.monthlyBudgetUsd ?? envCap);
      spent = Number(raw.spent_usd ?? raw.spentUsd ?? 0);
      if (!teamHint?.trim()) {
        team = String(raw.team ?? DEFAULT_TEAM);
      }
    }
  } catch {
    /* defaults */
  }
  return {
    team,
    monthly_budget_usd: Number.isFinite(monthly) ? monthly : envCap,
    spent_usd: Number.isFinite(spent) ? spent : 0,
  };
}

function extractBearer(authHeader: string | undefined): string {
  if (!authHeader) return "";
  const m = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  return m ? m[1].trim() : authHeader.trim();
}

function unauthorized(res: http.ServerResponse, id: unknown): void {
  res.writeHead(401, { "content-type": "application/json" });
  res.end(
    JSON.stringify({
      jsonrpc: "2.0",
      id: id ?? null,
      error: { code: -32001, message: "Unauthorized: invalid service key" },
    })
  );
}

function okResult(res: http.ServerResponse, id: unknown, result: unknown): void {
  res.writeHead(200, {
    "content-type": "application/json",
    "x-secgate-nexla": "shim",
  });
  res.end(JSON.stringify({ jsonrpc: "2.0", id, result }));
}

function toolBudgetResult(team?: string): {
  content: Array<{ type: string; text: string }>;
} {
  const budget = loadBudgetPayload(team);
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(budget),
      },
    ],
  };
}

export function handleJsonRpc(body: unknown): {
  status: number;
  payload: Record<string, unknown>;
} {
  const req = (body ?? {}) as {
    jsonrpc?: string;
    id?: unknown;
    method?: string;
    params?: { name?: string; arguments?: { team?: string } };
  };
  const id = req.id ?? 1;
  const method = String(req.method ?? "");

  if (method === "initialize") {
    return {
      status: 200,
      payload: {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: {
            name: "secgate-nexla-shim",
            version: "0.1.0",
            title: "Nexla MCP shim (demo stand-in)",
          },
        },
      },
    };
  }

  if (method === "tools/list" || method === "tools/list_changed") {
    return {
      status: 200,
      payload: {
        jsonrpc: "2.0",
        id,
        result: {
          tools: [
            {
              name: TOOL_NAME,
              description:
                "Return team monthly budget and spend (Nexla-compatible demo shim).",
              inputSchema: {
                type: "object",
                properties: {
                  team: { type: "string", description: "Team slug" },
                },
              },
            },
          ],
        },
      },
    };
  }

  if (method === "tools/call") {
    const name = req.params?.name ?? "";
    if (name !== TOOL_NAME) {
      return {
        status: 200,
        payload: {
          jsonrpc: "2.0",
          id,
          error: {
            code: -32601,
            message: `Unknown tool: ${name} (shim exposes ${TOOL_NAME})`,
          },
        },
      };
    }
    const team = req.params?.arguments?.team;
    return {
      status: 200,
      payload: {
        jsonrpc: "2.0",
        id,
        result: toolBudgetResult(team),
      },
    };
  }

  return {
    status: 200,
    payload: {
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    },
  };
}

export function createServer(): http.Server {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);

    if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          transport: "nexla-mcp-shim",
          label: "Nexla budget ToolSet (MCP)",
          tool: TOOL_NAME,
          port: PORT,
          budgetFile: budgetFilePath(),
        })
      );
      return;
    }

    if (req.method !== "POST") {
      res.writeHead(405, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "POST JSON-RPC only" }));
      return;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    let body: unknown = {};
    try {
      const raw = Buffer.concat(chunks).toString("utf8");
      body = raw ? JSON.parse(raw) : {};
    } catch {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "Parse error" },
        })
      );
      return;
    }

    const id = (body as { id?: unknown })?.id ?? null;
    const key = extractBearer(req.headers.authorization);
    if (!key || key !== EXPECTED_KEY) {
      unauthorized(res, id);
      return;
    }

    // Accept both / and /mcp/... paths (matches Nexla URL shape)
    const { status, payload } = handleJsonRpc(body);
    res.writeHead(status, {
      "content-type": "application/json",
      "x-secgate-nexla": "shim",
    });
    res.end(JSON.stringify(payload));
  });
}

if (require.main === module) {
  const server = createServer();
  server.listen(PORT, "127.0.0.1", () => {
    console.log(
      `[nexla-shim] DEMO STAND-IN listening on http://127.0.0.1:${PORT}/`
    );
    console.log(
      `[nexla-shim] Point guardian at NEXLA_MCP_URL=http://127.0.0.1:${PORT}/mcp`
    );
    console.log(
      `[nexla-shim] Service key (fake): ${EXPECTED_KEY.slice(0, 12)}…`
    );
    console.log(
      `[nexla-shim] Tool: ${TOOL_NAME} ← swap URL/key for real Nexla at booth`
    );
  });
}
