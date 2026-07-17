#!/usr/bin/env node
/**
 * Stdio MCP server for Cursor (primary single-machine demo path).
 *
 * Cursor launches this as a child process — no localhost HTTP required for the
 * MCP transport. Tool calls still go through PolicyEngine → upstream REST (:3100).
 *
 * Env:
 *   SECGATE_MCP_TOKEN / SECGATE_DEV_TOKEN  — Bearer token (default: dev-agent-token-PHASE2)
 *   SECGATE_MCP_URL                       — upstream REST (default: http://127.0.0.1:3100)
 *   SECGATE_POLICY_FILE                   — policy.yaml path
 *   SECGATE_MCP_STDIO_LINES=1             — NDJSON on stdin (test scripts)
 */
import readline from "readline";
import { PolicyEngine } from "./policy";
import { handleMcpJsonRpc, type McpJsonRpcRequest } from "./mcp-core";

const UPSTREAM = process.env.SECGATE_MCP_URL ?? "http://127.0.0.1:3100";
const TOKEN =
  process.env.SECGATE_MCP_TOKEN ??
  process.env.SECGATE_DEV_TOKEN ??
  "dev-agent-token-PHASE2";

const engine = new PolicyEngine();
engine.watch();

const authorization = `Bearer ${TOKEN.replace(/^Bearer\s+/i, "")}`;

async function emitAudit(event: {
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
}): Promise<void> {
  try {
    await fetch(`${UPSTREAM}/events/audit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(event),
    });
  } catch (err) {
    console.error(
      "[mcp-stdio] audit emit failed:",
      (err as Error).message
    );
  }
}

function writeMessage(msg: unknown): void {
  const json = JSON.stringify(msg);
  if (process.env.SECGATE_MCP_STDIO_LINES === "1") {
    process.stdout.write(json + "\n");
    return;
  }
  const frame = `Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n${json}`;
  process.stdout.write(frame);
}

async function handleRaw(raw: string): Promise<void> {
  let body: McpJsonRpcRequest;
  try {
    body = JSON.parse(raw) as McpJsonRpcRequest;
  } catch (err) {
    writeMessage({
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32700,
        message: `Parse error: ${(err as Error).message}`,
      },
    });
    return;
  }

  const response = await handleMcpJsonRpc(body, {
    engine,
    upstream: UPSTREAM,
    authorization,
    emitAudit,
  });
  if (response) writeMessage(response);
}

/** Content-Length framed reader (MCP / LSP style) — what Cursor uses. */
function startFramedReader(): void {
  let buffer = Buffer.alloc(0);
  let busy = Promise.resolve();

  process.stdin.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    busy = busy.then(async () => {
      while (true) {
        const headerEnd = buffer.indexOf("\r\n\r\n");
        if (headerEnd === -1) return;
        const header = buffer.subarray(0, headerEnd).toString("utf8");
        const match = /Content-Length:\s*(\d+)/i.exec(header);
        if (!match) {
          buffer = buffer.subarray(headerEnd + 4);
          continue;
        }
        const length = Number(match[1]);
        const bodyStart = headerEnd + 4;
        if (buffer.length < bodyStart + length) return;
        const raw = buffer
          .subarray(bodyStart, bodyStart + length)
          .toString("utf8");
        buffer = buffer.subarray(bodyStart + length);
        await handleRaw(raw);
      }
    });
  });
}

function startLineReader(): void {
  const rl = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });
  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith("{")) return;
    void handleRaw(trimmed);
  });
}

if (process.env.SECGATE_MCP_STDIO_LINES === "1") {
  startLineReader();
} else {
  startFramedReader();
}

console.error(
  `[mcp-stdio] SecGate MCP ready (stdio) upstream=${UPSTREAM} policy=${engine.path}`
);
