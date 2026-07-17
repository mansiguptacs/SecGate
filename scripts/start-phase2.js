#!/usr/bin/env node
/**
 * Start Phase 2 stack: infra-mcp (API + dashboard) + Pomerium policy shim + guardian.
 * Optionally starts the local Nexla MCP budget shim when NEXLA_MCP_URL points at it
 * (or when NEXLA_USE_SHIM=1).
 */
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const root = path.resolve(__dirname, "..");

/** Load gitignored .env into process.env (does not override existing exports). */
function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadDotEnv(path.join(root, ".env"));

const kids = [];

const MCP_PORT = process.env.SECGATE_PORT || "3100";
const GATEWAY_PORT = process.env.SECGATE_GATEWAY_PORT || "3200";
const NEXLA_SHIM_PORT = process.env.NEXLA_SHIM_PORT || "3300";
const MCP_URL = `http://127.0.0.1:${MCP_PORT}`;
const GATEWAY_URL = `http://127.0.0.1:${GATEWAY_PORT}`;

const DEFAULT_SHIM_URL = `http://127.0.0.1:${NEXLA_SHIM_PORT}/mcp`;
const DEFAULT_SHIM_KEY = "nxl_sk_secgate_demo_shim";

function wantsNexlaShim() {
  if (process.env.NEXLA_USE_SHIM === "0") return false;
  if (process.env.NEXLA_USE_SHIM === "1") return true;
  const url = process.env.NEXLA_MCP_URL || "";
  return (
    !url ||
    url.includes("127.0.0.1") ||
    url.includes("localhost") ||
    url.includes("nexla-shim")
  );
}

const useShim = wantsNexlaShim();
const NEXLA_MCP_URL = useShim
  ? process.env.NEXLA_MCP_URL || DEFAULT_SHIM_URL
  : process.env.NEXLA_MCP_URL || "";
const NEXLA_SERVICE_KEY = useShim
  ? process.env.NEXLA_SERVICE_KEY ||
    process.env.NEXLA_API_KEY ||
    DEFAULT_SHIM_KEY
  : process.env.NEXLA_SERVICE_KEY || process.env.NEXLA_API_KEY || "";

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
if (useShim && NEXLA_MCP_URL) {
  console.log(
    "  Nexla:          local MCP shim :" +
      NEXLA_SHIM_PORT +
      " (demo stand-in — swap real URL/key at booth)"
  );
} else if (NEXLA_MCP_URL) {
  console.log("  Nexla:          " + NEXLA_MCP_URL);
} else {
  console.log("  Nexla:          off → data/budget.json (local badge)");
}
console.log("");
console.log("  Dev token:      Bearer dev-agent-token-PHASE2");
console.log("  Guardian token: Bearer guardian-agent-token-PHASE2");
console.log("");

let delay = 0;

if (useShim && NEXLA_MCP_URL) {
  run("nexla-shim", "npm", ["run", "start", "-w", "@secgate/nexla"], {
    NEXLA_SHIM_PORT,
    NEXLA_SERVICE_KEY,
    NEXLA_BUDGET_TOOL: process.env.NEXLA_BUDGET_TOOL || "get_team_budget",
    NEXLA_TEAM: process.env.NEXLA_TEAM || "platform-eng",
    SECGATE_BUDGET_USD: process.env.SECGATE_BUDGET_USD || "500",
    SECGATE_BUDGET_FILE: process.env.SECGATE_BUDGET_FILE || "",
    SECGATE_DATA_DIR: process.env.SECGATE_DATA_DIR || path.join(root, "data"),
  });
  delay = 400;
}

setTimeout(() => {
  run("infra-mcp", "npm", ["run", "start", "-w", "infra-mcp"], {
    SECGATE_PORT: MCP_PORT,
    SECGATE_PHASE: process.env.SECGATE_PHASE || (BACKEND === "akash" ? "3" : "4"),
    SECGATE_BUDGET_USD: process.env.SECGATE_BUDGET_USD || "500",
    SECGATE_GATEWAY_URL: GATEWAY_URL,
    BACKEND,
    AKASH_API_KEY: process.env.AKASH_API_KEY || process.env.AKASH_CONSOLE_API_KEY || "",
    AKASH_DRY_RUN: process.env.AKASH_DRY_RUN || "",
    AKASH_DEPOSIT_USD: process.env.AKASH_DEPOSIT_USD || "0.5",
    AKASH_CONSOLE_API_URL:
      process.env.AKASH_CONSOLE_API_URL || "https://console-api.akash.network",
    NEXLA_MCP_URL,
    NEXLA_SERVICE_KEY,
    NEXLA_BUDGET_TOOL: process.env.NEXLA_BUDGET_TOOL || "get_team_budget",
  });
}, delay);

setTimeout(() => {
  run("pomerium-shim", "npm", ["run", "start", "-w", "@secgate/pomerium"], {
    SECGATE_GATEWAY_PORT: GATEWAY_PORT,
    SECGATE_MCP_URL: MCP_URL,
    SECGATE_POLICY_FILE: policyPath,
  });
}, delay + 800);

setTimeout(() => {
  run("guardian", "npm", ["run", "start", "-w", "guardian"], {
    SECGATE_MCP_URL: MCP_URL,
    SECGATE_GATEWAY_URL: GATEWAY_URL,
    SECGATE_BUDGET_USD: process.env.SECGATE_BUDGET_USD || "500",
    SECGATE_GUARDIAN_TOKEN:
      process.env.SECGATE_GUARDIAN_TOKEN || "guardian-agent-token-PHASE2",
    SECGATE_ABUSE_THRESHOLD: process.env.SECGATE_ABUSE_THRESHOLD || "3",
    SECGATE_ORPHAN_IDLE_MIN: process.env.SECGATE_ORPHAN_IDLE_MIN || "15",
    SECGATE_ORPHAN_SWEEP: process.env.SECGATE_ORPHAN_SWEEP || "1",
    NEXLA_MCP_URL,
    NEXLA_SERVICE_KEY,
    NEXLA_BUDGET_TOOL: process.env.NEXLA_BUDGET_TOOL || "get_team_budget",
    NEXLA_TIMEOUT_MS: process.env.NEXLA_TIMEOUT_MS || "3000",
    NEXLA_TEAM: process.env.NEXLA_TEAM || "platform-eng",
    ZERO_TIMEOUT_MS: process.env.ZERO_TIMEOUT_MS || "3000",
    ZERO_BIN: process.env.ZERO_BIN || "",
    ZERO_FORCE_OFF: process.env.ZERO_FORCE_OFF || "",
  });
}, delay + 1600);
