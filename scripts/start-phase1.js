#!/usr/bin/env node
/**
 * Start Phase 1 stack: infra-mcp (API + dashboard) then guardian.
 */
const { spawn } = require("child_process");
const path = require("path");

const root = path.resolve(__dirname, "..");
const kids = [];

function run(name, command, args, extraEnv = {}) {
  const child = spawn(command, args, {
    cwd: root,
    env: { ...process.env, ...extraEnv },
    stdio: "inherit",
  });
  child.on("exit", (code) => {
    console.log(`[start-phase1] ${name} exited (${code})`);
  });
  kids.push(child);
  return child;
}

function shutdown() {
  for (const c of kids) {
    try {
      c.kill("SIGTERM");
    } catch (_) {}
  }
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log("Starting SecGate Phase 1…");
console.log("  Control Tower → http://localhost:3100/");
console.log("  API health    → http://localhost:3100/health");
console.log("");

run("infra-mcp", "npm", ["run", "start", "-w", "infra-mcp"], {
  SECGATE_PORT: process.env.SECGATE_PORT || "3100",
  SECGATE_BUDGET_USD: process.env.SECGATE_BUDGET_USD || "500",
});

setTimeout(() => {
  run("guardian", "npm", ["run", "start", "-w", "guardian"], {
    SECGATE_MCP_URL: process.env.SECGATE_MCP_URL || "http://localhost:3100",
    SECGATE_BUDGET_USD: process.env.SECGATE_BUDGET_USD || "500",
  });
}, 1200);
