#!/usr/bin/env node
/**
 * Smoke-test stdio MCP: initialize + tools/list (+ optional tools/call).
 * Usage: node scripts/test-mcp-stdio.js
 */
const { spawn } = require("child_process");
const path = require("path");

const root = path.resolve(__dirname, "..");
const entry = path.join(root, "pomerium", "dist", "mcp-stdio.js");

const child = spawn(
  process.execPath,
  [entry],
  {
    cwd: root,
    env: {
      ...process.env,
      SECGATE_MCP_STDIO_LINES: "1",
      SECGATE_MCP_TOKEN: process.env.SECGATE_MCP_TOKEN || "dev-agent-token-PHASE2",
      SECGATE_MCP_URL: process.env.SECGATE_MCP_URL || "http://127.0.0.1:3100",
      SECGATE_POLICY_FILE:
        process.env.SECGATE_POLICY_FILE ||
        path.join(root, "pomerium", "policy.yaml"),
    },
    stdio: ["pipe", "pipe", "pipe"],
  }
);

let stdout = "";
let stderr = "";
child.stdout.on("data", (d) => {
  stdout += d.toString();
});
child.stderr.on("data", (d) => {
  stderr += d.toString();
});

function send(obj) {
  child.stdin.write(JSON.stringify(obj) + "\n");
}

function waitForResponses(n, ms = 5000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      const lines = stdout
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.startsWith("{"));
      if (lines.length >= n) {
        resolve(lines.slice(0, n).map((l) => JSON.parse(l)));
        return;
      }
      if (Date.now() - start > ms) {
        reject(
          new Error(
            `timeout waiting for ${n} responses; got ${lines.length}\nstdout=${stdout}\nstderr=${stderr}`
          )
        );
        return;
      }
      setTimeout(tick, 50);
    };
    tick();
  });
}

(async () => {
  try {
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test-mcp-stdio", version: "0.0.1" },
      },
    });
    send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });

    const [init, list] = await waitForResponses(2);
    if (!init.result?.serverInfo?.name) {
      throw new Error("initialize missing serverInfo: " + JSON.stringify(init));
    }
    const tools = list.result?.tools ?? [];
    const names = tools.map((t) => t.name);
    const expected = [
      "plan_deployment",
      "estimate_cost",
      "apply_deployment",
      "destroy_deployment",
      "list_deployments",
    ];
    for (const n of expected) {
      if (!names.includes(n)) throw new Error(`missing tool ${n}`);
    }
    console.log("OK initialize:", init.result.serverInfo.name);
    console.log("OK tools/list:", names.join(", "));

    // Optional upstream call if :3100 is up
    send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "list_deployments", arguments: {} },
    });
    try {
      const [call] = await waitForResponses(3, 3000).then((all) => [all[2]]);
      const text = call.result?.content?.[0]?.text ?? JSON.stringify(call);
      console.log("OK tools/call list_deployments:", String(text).slice(0, 200));
    } catch (err) {
      console.log(
        "SKIP tools/call (upstream may be down):",
        (err.message || err).split("\n")[0]
      );
    }

    child.kill("SIGTERM");
    process.exit(0);
  } catch (err) {
    console.error("FAIL:", err.message || err);
    console.error("stderr:", stderr);
    child.kill("SIGTERM");
    process.exit(1);
  }
})();
