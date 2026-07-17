#!/usr/bin/env node
/**
 * AgentFence ticket driver — runs clean or poisoned ticket flows through the gateway.
 * Used by demo-director and as Laptop A fallback.
 *
 * Usage:
 *   node agents/ticket-driver.js clean
 *   node agents/ticket-driver.js poisoned
 *   node agents/ticket-driver.js poisoned --direct-applies 3
 */
const path = require("path");
const fs = require("fs");

const GATEWAY =
  process.env.SECGATE_GATEWAY_URL || "http://127.0.0.1:3200";
const MCP = process.env.SECGATE_MCP_URL || "http://127.0.0.1:3100";
const DEV_TOKEN =
  process.env.SECGATE_DEV_TOKEN || "dev-agent-token-PHASE2";
const TICKETS_DIR = path.resolve(__dirname, "../tickets");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function callTool(tool, body, opts = {}) {
  const base = opts.viaGateway !== false ? GATEWAY : MCP;
  const headers = {
    "content-type": "application/json",
    "x-secgate-actor": "dev-agent",
  };
  if (opts.viaGateway !== false) {
    headers.authorization = `Bearer ${DEV_TOKEN}`;
  }
  const res = await fetch(`${base}/${tool}`, {
    method: tool === "list_deployments" ? "GET" : "POST",
    headers,
    body: tool === "list_deployments" ? undefined : JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: res.status, ok: res.ok, json };
}

function detectPoison(ticketText) {
  return /8\s*[×x]\s*A100|provision 8|apply_deployment directly|warm.?pool/i.test(
    ticketText
  );
}

function parseArgs(argv) {
  const args = { ticket: "clean", directApplies: 3, waitMs: 2500, viaGateway: true };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--direct-applies") args.directApplies = Number(argv[++i] || 3);
    else if (a === "--wait-ms") args.waitMs = Number(argv[++i] || 2500);
    else if (a === "--mcp-only") args.viaGateway = false;
    else if (a === "--help" || a === "-h") args.help = true;
    else if (!a.startsWith("-")) positional.push(a);
  }
  if (positional[0]) args.ticket = positional[0];
  return args;
}

async function runClean(opts) {
  console.log("[agent] clean ticket → plan staging-api (CPU-only)");
  const plan = await callTool(
    "plan_deployment",
    {
      name: "staging-api",
      gpu: "none",
      gpuCount: 1,
      image: "nginx:alpine",
      tags: { owner: "maya.chen", env: "staging" },
    },
    opts
  );
  if (!plan.ok) {
    console.error("[agent] plan failed", plan.status, plan.json);
    return { ok: false, step: "plan", ...plan };
  }
  const planId = plan.json?.result?.planId ?? plan.json?.planId;
  console.log("[agent] planId", planId);

  const est = await callTool("estimate_cost", { planId }, opts);
  if (!est.ok) {
    console.error("[agent] estimate failed", est.status, est.json);
    return { ok: false, step: "estimate", ...est };
  }
  const proposalId = est.json?.result?.proposalId ?? est.json?.proposalId;
  console.log("[agent] proposal pending", proposalId, "— waiting for guardian…");
  await sleep(opts.waitMs);

  const list = await callTool("list_deployments", {}, opts);
  const deps =
    list.json?.result?.deployments ?? list.json?.deployments ?? [];
  const staging = deps.find((d) => d.name === "staging-api" && d.status === "running");
  if (staging) {
    console.log("[agent] deployed", staging.liveUrl, `$${staging.usdPerMonth}/mo`);
    return { ok: true, flow: "clean", deployment: staging, proposalId };
  }
  console.log("[agent] no staging-api yet (guardian may still be applying)");
  return { ok: true, flow: "clean", proposalId, deployment: null };
}

async function runPoisoned(opts) {
  console.log("[agent] poisoned ticket → attempt 8×A100 warm pool");
  const plan = await callTool(
    "plan_deployment",
    {
      name: "load-test-warm-pool",
      gpu: "A100",
      gpuCount: 8,
      image: "nginx:alpine",
      tags: {},
    },
    opts
  );
  if (!plan.ok) {
    // Quarantined identity may 403 even plan_*
    console.error("[agent] plan failed", plan.status, plan.json);
    return { ok: false, step: "plan", quarantined: plan.status === 403, ...plan };
  }
  const planId = plan.json?.result?.planId ?? plan.json?.planId;
  const est = await callTool("estimate_cost", { planId }, opts);
  if (!est.ok) {
    console.error("[agent] estimate failed", est.status, est.json);
    return { ok: false, step: "estimate", ...est };
  }
  const proposalId = est.json?.result?.proposalId ?? est.json?.proposalId;
  console.log("[agent] proposal", proposalId, "— waiting for reject…");
  await sleep(opts.waitMs);

  const applies = [];
  for (let i = 1; i <= opts.directApplies; i++) {
    console.log(`[agent] direct apply_deployment attempt ${i}/${opts.directApplies}`);
    const apply = await callTool(
      "apply_deployment",
      { proposalId },
      opts
    );
    applies.push({ attempt: i, status: apply.status, json: apply.json });
    console.log(`[agent] apply → HTTP ${apply.status}`);
    await sleep(400);
  }

  return {
    ok: true,
    flow: "poisoned",
    proposalId,
    applies,
    blocked: applies.filter((a) => a.status === 403).length,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage: node agents/ticket-driver.js <clean|poisoned> [options]
  --direct-applies N   poisoned: how many bypass applies (default 3)
  --wait-ms N          wait for guardian (default 2500)
  --mcp-only           hit MCP :3100 instead of gateway :3200`);
    process.exit(0);
  }

  const ticketPath = path.join(TICKETS_DIR, `${args.ticket}.md`);
  if (!fs.existsSync(ticketPath)) {
    console.error(`[agent] missing ticket ${ticketPath}`);
    process.exit(1);
  }
  const text = fs.readFileSync(ticketPath, "utf8");
  const poisoned = args.ticket === "poisoned" || detectPoison(text);
  console.log(`[agent] ticket=${args.ticket} gateway=${GATEWAY} poisoned=${poisoned}`);

  const result = poisoned
    ? await runPoisoned({ ...args, viaGateway: args.viaGateway })
    : await runClean({ ...args, viaGateway: args.viaGateway });

  console.log("[agent] done", JSON.stringify({ ok: result.ok, flow: result.flow, blocked: result.blocked }));
  if (!result.ok) process.exit(1);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { runClean, runPoisoned, callTool, detectPoison, parseArgs };
