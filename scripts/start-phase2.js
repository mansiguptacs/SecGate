#!/usr/bin/env node
/**
 * Start Phase 2 stack: infra-mcp (API + dashboard) + Pomerium policy shim + guardian.
 */
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const root = path.resolve(__dirname, "..");
const kids = [];

const MCP_PORT = process.env.SECGATE_PORT || "3100";
const GATEWAY_PORT = process.env.SECGATE_GATEWAY_PORT || "3200";
const MCP_URL = `http://127.0.0.1:${MCP_PORT}`;
const GATEWAY_URL = `http://127.0.0.1:${GATEWAY_PORT}`;

// Ensure policy.yaml exists (quarantine may rewrite it; keep a pristine seed)
const policyPath = path.join(root, "pomerium", "policy.yaml");
const policySeed = path.join(root, "pomerium", "policy.seed.yaml");
if (fs.existsSync(policySeed)) {
  fs.copyFileSync(policySeed, policyPath);
}

function run(name, command, args, extraEnv = {}) {
  const child = spawn(command, args, {
    cwd: root,
    env: { ...process.env, ...extraEnv },
    stdio: "inherit",
  });
  child.on("exit", (code) => {
    console.log(`[start-phase2] ${name} exited (${code})`);
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

const BACKEND = (process.env.BACKEND || process.env.SECGATE_BACKEND || "mock").toLowerCase();
const phaseLabel = BACKEND === "akash" ? "Phase 3 (Akash backend)" : "Phase 2";

console.log("Starting SecGate " + phaseLabel + "…");
console.log("  Control Tower → http://localhost:" + MCP_PORT + "/");
console.log("  Pomerium shim → http://localhost:" + GATEWAY_PORT + "/  (Laptop A / agents)");
console.log("  Backend:        " + BACKEND + (BACKEND === "akash" ? " (set AKASH_API_KEY for live leases)" : " — default; BACKEND=akash to swap)"));
console.log("  Label: Pomerium policy shim — swap for real Pomerium when IdP ready");
console.log("");
console.log("  Dev token:      Bearer dev-agent-token-PHASE2");
console.log("  Guardian token: Bearer guardian-agent-token-PHASE2");
console.log("");

run("infra-mcp", "npm", ["run", "start", "-w", "infra-mcp"], {
  SECGATE_PORT: MCP_PORT,
  SECGATE_PHASE: BACKEND === "akash" ? "3" : "2",
  SECGATE_BUDGET_USD: process.env.SECGATE_BUDGET_USD || "500",
  SECGATE_GATEWAY_URL: GATEWAY_URL,
  BACKEND,
  AKASH_API_KEY: process.env.AKASH_API_KEY || process.env.AKASH_CONSOLE_API_KEY || "",
  AKASH_DRY_RUN: process.env.AKASH_DRY_RUN || "",
  AKASH_DEPOSIT_USD: process.env.AKASH_DEPOSIT_USD || "0.5",
  AKASH_CONSOLE_API_URL:
    process.env.AKASH_CONSOLE_API_URL || "https://console-api.akash.network",
});

setTimeout(() => {
  run("pomerium-shim", "npm", ["run", "start", "-w", "@secgate/pomerium"], {
    SECGATE_GATEWAY_PORT: GATEWAY_PORT,
    SECGATE_MCP_URL: MCP_URL,
    SECGATE_POLICY_FILE: policyPath,
  });
}, 800);

setTimeout(() => {
  run("guardian", "npm", ["run", "start", "-w", "guardian"], {
    SECGATE_MCP_URL: MCP_URL,
    SECGATE_GATEWAY_URL: GATEWAY_URL,
    SECGATE_BUDGET_USD: process.env.SECGATE_BUDGET_USD || "500",
    SECGATE_GUARDIAN_TOKEN:
      process.env.SECGATE_GUARDIAN_TOKEN || "guardian-agent-token-PHASE2",
    SECGATE_ABUSE_THRESHOLD: process.env.SECGATE_ABUSE_THRESHOLD || "3",
  });
}, 1600);
