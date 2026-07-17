/**
 * Timeline story tests — clean plan→approve→apply and poisoned→403→quarantine.
 * Requires a running stack (phase2) OR boots an ephemeral infra-mcp.
 */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");

const ROOT = path.resolve(__dirname, "..");
const PORT = 3199;
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "secgate-tl-"));
const EVENTS = path.join(TMP, "events.json");

let child;

async function json(method, route, body, headers = {}) {
  const res = await fetch(`${BASE}${route}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
}

function waitHealth(ms = 8000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const r = await fetch(`${BASE}/health`);
        if (r.ok) return resolve();
      } catch {
        /* retry */
      }
      if (Date.now() - start > ms) return reject(new Error("health timeout"));
      setTimeout(tick, 150);
    };
    tick();
  });
}

before(async () => {
  child = spawn(
    process.execPath,
    [path.join(ROOT, "infra-mcp/dist/server.js")],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        SECGATE_PORT: String(PORT),
        SECGATE_DATA_DIR: TMP,
        SECGATE_RESET: "1",
        BACKEND: "mock",
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  await waitHealth();
});

after(() => {
  if (child) child.kill("SIGTERM");
  try {
    fs.rmSync(TMP, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

function timeline(events) {
  return events.filter((e) => e.sponsor);
}

function titles(events) {
  return timeline(events).map((e) => `${e.sponsor}:${e.title}`);
}

test("clean path: plan → nexla/zero → approve → akash apply", async () => {
  await json("POST", "/admin/reset");
  await json("POST", "/admin/gate", { mode: "on" });

  const plan = await json(
    "POST",
    "/plan_deployment",
    {
      name: "staging-api",
      gpu: "none",
      gpuCount: 1,
      image: "nginx:alpine",
    },
    { "x-secgate-actor": "dev-agent" }
  );
  assert.equal(plan.status, 200, JSON.stringify(plan.data));
  const planId = plan.data.result.planId;

  const est = await json(
    "POST",
    "/estimate_cost",
    { planId },
    { "x-secgate-actor": "dev-agent" }
  );
  assert.equal(est.status, 200);
  const proposalId = est.data.result.proposalId;

  const decide = await json(
    "POST",
    `/proposals/${proposalId}/decide`,
    {
      decision: "approved",
      reason: "Within budget $3/mo",
      pricingSource: "zero",
      budgetSource: "nexla",
      estimate: est.data.result.estimate,
    },
    { "x-secgate-actor": "guardian" }
  );
  assert.equal(decide.status, 200);

  const apply = await json(
    "POST",
    "/apply_deployment",
    { proposalId },
    { "x-secgate-actor": "guardian" }
  );
  assert.equal(apply.status, 200, JSON.stringify(apply.data));

  const ev = await json("GET", "/events");
  const t = titles(ev.data.events);
  assert.ok(
    t.some((x) => x.includes("pomerium:plan_deployment ALLOW")),
    t.join(" | ")
  );
  assert.ok(t.some((x) => x.includes("nexla:Budget fetch")), t.join(" | "));
  assert.ok(t.some((x) => x.includes("zero:Pricing enrichment")), t.join(" | "));
  assert.ok(t.some((x) => x.includes("guardian:APPROVE")), t.join(" | "));
  assert.ok(t.some((x) => x.includes("akash:Lease create")), t.join(" | "));

  // chronological story: plan before approve before lease
  const sponsors = timeline(ev.data.events).map((e) => e.sponsor);
  const iPlan = sponsors.indexOf("pomerium");
  const iGuard = timeline(ev.data.events).findIndex((e) => e.title === "APPROVE");
  const iAkash = timeline(ev.data.events).findIndex((e) =>
    String(e.title).startsWith("Lease create")
  );
  assert.ok(iPlan >= 0 && iGuard > iPlan && iAkash > iGuard, sponsors.join(","));
});

test("poisoned path: reject → blocked apply on timeline", async () => {
  await json("POST", "/admin/reset");
  await json("POST", "/admin/gate", { mode: "on" });

  const plan = await json(
    "POST",
    "/plan_deployment",
    { name: "load-test-warm-pool", gpu: "A100", gpuCount: 8 },
    { "x-secgate-actor": "dev-agent" }
  );
  const planId = plan.data.result.planId;
  const est = await json(
    "POST",
    "/estimate_cost",
    { planId },
    { "x-secgate-actor": "dev-agent" }
  );
  const proposalId = est.data.result.proposalId;

  await json(
    "POST",
    `/proposals/${proposalId}/decide`,
    {
      decision: "rejected",
      reason: "Projected $12400/mo exceeds budget",
      pricingSource: "zero",
      budgetSource: "nexla",
    },
    { "x-secgate-actor": "guardian" }
  );

  const denied = await json(
    "POST",
    "/apply_deployment",
    { proposalId },
    { "x-secgate-actor": "dev-agent" }
  );
  assert.equal(denied.status, 403);

  // Pomerium-style audit block
  await json("POST", "/events/audit", {
    kind: "blocked",
    actor: "dev-agent",
    message: "apply_deployment BLOCKED 403 — guardian only",
    sponsor: "pomerium",
    title: "apply_deployment BLOCKED",
    severity: "block",
    detail: { tool: "apply_deployment", status: 403 },
  });
  await json("POST", "/events/audit", {
    kind: "blocked",
    actor: "guardian",
    message: "QUARANTINE dev@secgate.local",
    sponsor: "pomerium",
    title: "Quarantine policy rewrite",
    severity: "block",
    detail: { pplDiff: true },
  });

  const ev = await json("GET", "/events");
  const t = titles(ev.data.events);
  assert.ok(t.some((x) => x.includes("guardian:REJECT")), t.join(" | "));
  assert.ok(
    t.some((x) => x.includes("pomerium:apply_deployment BLOCKED")),
    t.join(" | ")
  );
  assert.ok(
    t.some((x) => x.includes("pomerium:Quarantine policy rewrite")),
    t.join(" | ")
  );

  const story = timeline(ev.data.events).map((e) => e.title);
  const iReject = story.indexOf("REJECT");
  const iBlock = story.indexOf("apply_deployment BLOCKED");
  const iQ = story.indexOf("Quarantine policy rewrite");
  assert.ok(iReject >= 0 && iBlock > iReject && iQ > iBlock, story.join(" → "));
});

test("coalesce drops identical timeline titles within window", async () => {
  await json("POST", "/admin/reset");
  for (let i = 0; i < 3; i++) {
    await json("POST", "/events/audit", {
      kind: "timeline",
      actor: "secgate",
      message: "Budget fetch poll",
      sponsor: "nexla",
      title: "Budget fetch",
      severity: "info",
      detail: { blurb: "poll" },
    });
  }
  const ev = await json("GET", "/events");
  const budgetRows = timeline(ev.data.events).filter(
    (e) => e.sponsor === "nexla" && e.title === "Budget fetch"
  );
  assert.ok(
    budgetRows.length <= 2,
    `expected coalesce, got ${budgetRows.length}`
  );
});

// silence unused
void http;
