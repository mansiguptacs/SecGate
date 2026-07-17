import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "http";
import os from "os";
import path from "path";
import fs from "fs";
import { createApp } from "../src/server";
import { evaluateProposal } from "../../guardian/src/policy";
import type { Proposal } from "@secgate/shared";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "secgate-phase1-"));
const eventsFile = path.join(tmpDir, "events.json");

let server: http.Server;
let baseUrl: string;

async function json(
  method: string,
  urlPath: string,
  body?: unknown,
  headers?: Record<string, string>
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(headers ?? {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

before(async () => {
  const { app } = createApp({ eventsFile, resetOnStart: true });
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no port");
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("small deployment under budget: plan → estimate → guardian approve → apply", async () => {
  await json("POST", "/admin/reset");

  const plan = await json("POST", "/plan_deployment", {
    name: "staging-api",
    gpu: "none",
    gpuCount: 1,
    image: "ghcr.io/secgate/staging-api:latest",
  });
  assert.equal(plan.status, 200);
  assert.ok(plan.body.result.planId);

  const est = await json("POST", "/estimate_cost", {
    planId: plan.body.result.planId,
  });
  assert.equal(est.status, 200);
  assert.ok(est.body.result.estimate.usdPerMonth < 500);
  const proposalId = est.body.result.proposalId;

  const pending = await json("GET", "/proposals?status=pending");
  assert.equal(pending.body.proposals.length, 1);

  const decision = evaluateProposal(pending.body.proposals[0] as Proposal, {
    monthlyBudgetUsd: 500,
    committedSpendUsd: 0,
  });
  assert.equal(decision.decision, "approved");

  const decide = await json(
    "POST",
    `/proposals/${proposalId}/decide`,
    decision,
    { "x-secgate-actor": "guardian" }
  );
  assert.equal(decide.status, 200);
  assert.equal(decide.body.proposal.status, "approved");

  const apply = await json(
    "POST",
    "/apply_deployment",
    { proposalId },
    { "x-secgate-actor": "guardian" }
  );
  assert.equal(apply.status, 200);
  assert.equal(apply.body.result.status, "running");
  assert.ok(apply.body.result.usdPerMonth < 500);

  const list = await json("GET", "/list_deployments");
  assert.equal(list.body.result.deployments.length, 1);
  assert.equal(list.body.result.deployments[0].name, "staging-api");
  assert.ok(list.body.result.committedSpendUsd < 500);
});

test("8×A100 over budget: guardian rejects; apply denied for dev-agent", async () => {
  await json("POST", "/admin/reset");

  const plan = await json("POST", "/plan_deployment", {
    name: "load-test-cluster",
    gpu: "A100",
    gpuCount: 8,
  });
  assert.equal(plan.status, 200);

  const est = await json("POST", "/estimate_cost", {
    planId: plan.body.result.planId,
  });
  assert.equal(est.status, 200);
  const monthly = est.body.result.estimate.usdPerMonth;
  assert.ok(monthly >= 12000, `expected ~12400, got ${monthly}`);
  assert.ok(monthly <= 13000, `expected ~12400, got ${monthly}`);
  const proposalId = est.body.result.proposalId;

  const pending = await json("GET", "/proposals?status=pending");
  const decision = evaluateProposal(pending.body.proposals[0] as Proposal, {
    monthlyBudgetUsd: 500,
    committedSpendUsd: 0,
  });
  assert.equal(decision.decision, "rejected");
  assert.match(decision.reason, /exceeds team budget/i);

  await json("POST", `/proposals/${proposalId}/decide`, decision, {
    "x-secgate-actor": "guardian",
  });

  // Dev agent tries direct apply anyway (poisoned ticket path)
  const apply = await json(
    "POST",
    "/apply_deployment",
    { proposalId },
    { "x-secgate-actor": "dev-agent" }
  );
  assert.equal(apply.status, 403);
  assert.equal(apply.body.code, "GUARDIAN_DENIED");

  const list = await json("GET", "/list_deployments");
  assert.equal(list.body.result.deployments.length, 0);
  assert.equal(list.body.result.committedSpendUsd, 0);
});

test("list_deployments reflects state after apply + destroy", async () => {
  await json("POST", "/admin/reset");

  const plan = await json("POST", "/plan_deployment", {
    name: "ephemeral",
    gpu: "none",
    gpuCount: 1,
  });
  const est = await json("POST", "/estimate_cost", {
    planId: plan.body.result.planId,
  });
  const proposalId = est.body.result.proposalId;
  await json(
    "POST",
    `/proposals/${proposalId}/decide`,
    { decision: "approved", reason: "test" },
    { "x-secgate-actor": "guardian" }
  );
  const applied = await json(
    "POST",
    "/apply_deployment",
    { proposalId },
    { "x-secgate-actor": "guardian" }
  );
  const depId = applied.body.result.id;

  let list = await json("GET", "/list_deployments");
  assert.equal(list.body.result.deployments.filter((d: any) => d.status === "running").length, 1);

  await json(
    "POST",
    "/destroy_deployment",
    { deploymentId: depId },
    { "x-secgate-actor": "guardian" }
  );

  list = await json("GET", "/list_deployments");
  const running = list.body.result.deployments.filter((d: any) => d.status === "running");
  assert.equal(running.length, 0);
});

test("dashboard events endpoint records simulated actions", async () => {
  await json("POST", "/admin/reset");

  await json("POST", "/plan_deployment", {
    name: "dash-demo",
    gpu: "none",
    gpuCount: 1,
  });
  const plan2 = await json("POST", "/plan_deployment", {
    name: "gpu-bomb",
    gpu: "A100",
    gpuCount: 8,
  });
  await json("POST", "/estimate_cost", { planId: plan2.body.result.planId });

  const events = await json("GET", "/events");
  assert.ok(events.body.events.length >= 2);
  const kinds = events.body.events.map((e: any) => e.kind);
  assert.ok(kinds.includes("plan"));
  assert.ok(kinds.includes("estimate") || kinds.includes("proposal"));
  assert.equal(typeof events.body.budgetUsd, "number");
  assert.equal(events.body.budgetUsd, 500);

  // Persist check
  assert.ok(fs.existsSync(eventsFile));
  const disk = JSON.parse(fs.readFileSync(eventsFile, "utf8"));
  assert.ok(Array.isArray(disk));
  assert.ok(disk.length >= 2);
});

test("POST /admin/demo/disaster seeds 8×A100 with numeric committedSpendUsd", async () => {
  await json("POST", "/admin/reset");
  const r = await json("POST", "/admin/demo/disaster");
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.gate, "off");
  assert.equal(typeof r.body.committedSpendUsd, "number");
  assert.equal(r.body.committedSpendUsd, 12398);
  assert.equal(r.body.deployment?.usdPerMonth, 12398);
  assert.equal(r.body.deployment?.gpu, "A100");
  assert.equal(r.body.deployment?.gpuCount, 8);
  assert.equal(r.body.deployment?.status, "running");

  const events = await json("GET", "/events");
  assert.equal(events.body.committedSpendUsd, 12398);
  const msg = JSON.stringify(events.body.events);
  assert.doesNotMatch(msg, /\$undefined/);
  assert.match(msg, /12,?398/);
});

test("GET /budget serves team budget for Nexla API source", async () => {
  const one = await json("GET", "/budget?team=platform-eng");
  assert.equal(one.status, 200);
  assert.equal(one.body.team, "platform-eng");
  assert.equal(one.body.monthly_budget_usd, 500);
  assert.equal(one.body.spent_usd, 47);

  const all = await json("GET", "/budget");
  assert.equal(all.status, 200);
  assert.ok(Array.isArray(all.body.teams));
  assert.ok(all.body.teams.length >= 1);

  const missing = await json("GET", "/budget?team=no-such-team");
  assert.equal(missing.status, 404);
});
