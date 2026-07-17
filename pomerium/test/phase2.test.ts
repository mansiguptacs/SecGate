import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "http";
import os from "os";
import path from "path";
import fs from "fs";
import { createApp } from "../../infra-mcp/src/server";
import { createShim } from "../src/shim";
import { evaluateProposal } from "../../guardian/src/policy";
import { AbuseTracker, processAbuseOnce } from "../../guardian/src/index";
import type { Proposal } from "../../shared/src/types";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "secgate-phase2-"));
const eventsFile = path.join(tmpDir, "events.json");
const policyFile = path.join(tmpDir, "policy.yaml");

const SEED_POLICY = `version: secgate-ppl/v1
label: "Pomerium policy shim — swap for real Pomerium when IdP ready"
identities:
  - id: dev-agent
    email: dev@secgate.local
    token: dev-agent-token-PHASE2
    role: developer
  - id: guardian
    email: guardian@secgate.local
    token: guardian-agent-token-PHASE2
    role: guardian
allow_tools:
  - plan_deployment
  - estimate_cost
  - list_deployments
guardian_only_tools:
  - apply_deployment
  - destroy_deployment
abuse:
  blocked_mutate_threshold: 3
quarantine:
  identities: []
deny_rules: []
`;

const DEV = "dev-agent-token-PHASE2";
const GUARDIAN = "guardian-agent-token-PHASE2";

let mcpServer: http.Server;
let gwServer: http.Server;
let mcpUrl: string;
let gwUrl: string;
let shimEngine: ReturnType<typeof createShim>["engine"];

async function json(
  base: string,
  method: string,
  urlPath: string,
  body?: unknown,
  headers?: Record<string, string>
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${urlPath}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(headers ?? {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text };
  }
  return { status: res.status, body: parsed };
}

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

before(async () => {
  fs.writeFileSync(policyFile, SEED_POLICY);
  process.env.SECGATE_PHASE = "2";

  const { app: mcpApp } = createApp({ eventsFile, resetOnStart: true });
  await new Promise<void>((resolve) => {
    mcpServer = mcpApp.listen(0, "127.0.0.1", () => resolve());
  });
  const mcpAddr = mcpServer.address();
  if (!mcpAddr || typeof mcpAddr === "string") throw new Error("no mcp port");
  mcpUrl = `http://127.0.0.1:${mcpAddr.port}`;

  const { app: gwApp, engine } = createShim({
    policyPath: policyFile,
    upstream: mcpUrl,
  });
  shimEngine = engine;
  await new Promise<void>((resolve) => {
    gwServer = gwApp.listen(0, "127.0.0.1", () => resolve());
  });
  const gwAddr = gwServer.address();
  if (!gwAddr || typeof gwAddr === "string") throw new Error("no gw port");
  gwUrl = `http://127.0.0.1:${gwAddr.port}`;

  // Let /events include policy from gateway
  process.env.SECGATE_GATEWAY_URL = gwUrl;
});

beforeEach(async () => {
  fs.writeFileSync(policyFile, SEED_POLICY);
  shimEngine.reload();
  await json(mcpUrl, "POST", "/admin/reset");
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    gwServer.close((err) => (err ? reject(err) : resolve()));
  });
  await new Promise<void>((resolve, reject) => {
    mcpServer.close((err) => (err ? reject(err) : resolve()));
  });
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.SECGATE_GATEWAY_URL;
});

test("dev token: plan OK, apply → 403", async () => {
  const plan = await json(
    gwUrl,
    "POST",
    "/plan_deployment",
    { name: "staging-api", gpu: "none", gpuCount: 1 },
    bearer(DEV)
  );
  assert.equal(plan.status, 200, JSON.stringify(plan.body));
  assert.ok(plan.body.result.planId);

  const est = await json(
    gwUrl,
    "POST",
    "/estimate_cost",
    { planId: plan.body.result.planId },
    bearer(DEV)
  );
  assert.equal(est.status, 200);
  const proposalId = est.body.result.proposalId;

  const apply = await json(
    gwUrl,
    "POST",
    "/apply_deployment",
    { proposalId },
    bearer(DEV)
  );
  assert.equal(apply.status, 403);
  assert.equal(apply.body.code, "POLICY_DENIED");

  const events = await json(mcpUrl, "GET", "/events");
  const blocked = events.body.events.filter(
    (e: any) => e.kind === "blocked" || e.kind === "apply_denied"
  );
  assert.ok(blocked.length >= 1, "expected BLOCKED audit events");
  assert.ok(
    blocked.some((e: any) => /BLOCKED 403|denied/i.test(e.message)),
    "expected BLOCKED 403 message"
  );
});

test("guardian token: apply OK for under-budget proposal", async () => {
  const plan = await json(
    gwUrl,
    "POST",
    "/plan_deployment",
    { name: "staging-api", gpu: "none", gpuCount: 1 },
    bearer(DEV)
  );
  const est = await json(
    gwUrl,
    "POST",
    "/estimate_cost",
    { planId: plan.body.result.planId },
    bearer(DEV)
  );
  const proposalId = est.body.result.proposalId;

  const pending = await json(mcpUrl, "GET", "/proposals?status=pending");
  const decision = evaluateProposal(pending.body.proposals[0] as Proposal, {
    monthlyBudgetUsd: 500,
    committedSpendUsd: 0,
  });
  assert.equal(decision.decision, "approved");

  await json(mcpUrl, "POST", `/proposals/${proposalId}/decide`, decision, {
    "x-secgate-actor": "guardian",
  });

  const apply = await json(
    gwUrl,
    "POST",
    "/apply_deployment",
    { proposalId },
    bearer(GUARDIAN)
  );
  assert.equal(apply.status, 200, JSON.stringify(apply.body));
  assert.equal(apply.body.result.status, "running");
});

test("over-budget proposal still rejected by guardian", async () => {
  const plan = await json(
    gwUrl,
    "POST",
    "/plan_deployment",
    { name: "load-test", gpu: "A100", gpuCount: 8 },
    bearer(DEV)
  );
  const est = await json(
    gwUrl,
    "POST",
    "/estimate_cost",
    { planId: plan.body.result.planId },
    bearer(DEV)
  );
  assert.ok(est.body.result.estimate.usdPerMonth >= 12000);

  const pending = await json(mcpUrl, "GET", "/proposals?status=pending");
  const decision = evaluateProposal(pending.body.proposals[0] as Proposal, {
    monthlyBudgetUsd: 500,
    committedSpendUsd: 0,
  });
  assert.equal(decision.decision, "rejected");

  await json(mcpUrl, "POST", `/proposals/${est.body.result.proposalId}/decide`, decision, {
    "x-secgate-actor": "guardian",
  });

  // Dev still blocked by Pomerium even before status check
  const applyDev = await json(
    gwUrl,
    "POST",
    "/apply_deployment",
    { proposalId: est.body.result.proposalId },
    bearer(DEV)
  );
  assert.equal(applyDev.status, 403);
});

test("quarantine: after N blocked applies, even plan is denied", async () => {
  // Create a dummy proposal id — apply will be blocked at gateway before upstream
  for (let i = 0; i < 3; i++) {
    const apply = await json(
      gwUrl,
      "POST",
      "/apply_deployment",
      { proposalId: `prop-fake-${i}` },
      bearer(DEV)
    );
    assert.equal(apply.status, 403);
    assert.equal(apply.body.code, "POLICY_DENIED");
  }

  const tracker = new AbuseTracker({ threshold: 3 });
  const seen = new Set<string>();
  const result = await processAbuseOnce(tracker, mcpUrl, gwUrl, seen);
  assert.ok(result.quarantined.includes("dev-agent"));

  const plan = await json(
    gwUrl,
    "POST",
    "/plan_deployment",
    { name: "should-fail", gpu: "none", gpuCount: 1 },
    bearer(DEV)
  );
  assert.equal(plan.status, 403);
  assert.equal(plan.body.code, "QUARANTINED");

  // Guardian still works
  const planG = await json(
    gwUrl,
    "POST",
    "/plan_deployment",
    { name: "guardian-plan", gpu: "none", gpuCount: 1 },
    bearer(GUARDIAN)
  );
  assert.equal(planG.status, 200);

  const events = await json(mcpUrl, "GET", "/events");
  assert.ok(
    events.body.events.some(
      (e: any) => e.kind === "blocked" && /QUARANTINE|quarantin/i.test(e.message)
    )
  );
  assert.ok(events.body.policy?.snippet || events.body.policy?.policy);
});

test("explicit quarantine call denies plan for identity", async () => {
  const q = await json(
    gwUrl,
    "POST",
    "/admin/quarantine",
    {
      identity: "dev-agent",
      reason: "Explicit quarantine for demo",
    },
    bearer(GUARDIAN)
  );
  assert.equal(q.status, 200, JSON.stringify(q.body));

  const plan = await json(
    gwUrl,
    "POST",
    "/plan_deployment",
    { name: "blocked", gpu: "none", gpuCount: 1 },
    bearer(DEV)
  );
  assert.equal(plan.status, 403);
  assert.equal(plan.body.code, "QUARANTINED");
});

test("dashboard events show BLOCKED for denied apply", async () => {
  await json(
    gwUrl,
    "POST",
    "/apply_deployment",
    { proposalId: "prop-x" },
    bearer(DEV)
  );
  const events = await json(mcpUrl, "GET", "/events");
  const blocked = events.body.events.filter((e: any) => e.kind === "blocked");
  assert.ok(blocked.length >= 1);
  assert.match(blocked[blocked.length - 1].message, /BLOCKED 403/i);
});

test("missing token → 401", async () => {
  const plan = await json(gwUrl, "POST", "/plan_deployment", {
    name: "no-auth",
    gpu: "none",
    gpuCount: 1,
  });
  assert.equal(plan.status, 401);
});
