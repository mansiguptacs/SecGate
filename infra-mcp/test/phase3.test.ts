import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "http";
import os from "os";
import path from "path";
import fs from "fs";
import { createApp } from "../src/server";
import { evaluateProposal } from "../../guardian/src/policy";
import type { Proposal } from "@secgate/shared";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "secgate-phase3-"));
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
  // Force Akash dry-run (no credentials required)
  delete process.env.AKASH_API_KEY;
  delete process.env.AKASH_CONSOLE_API_KEY;
  process.env.AKASH_DRY_RUN = "1";
  const { app } = createApp({
    eventsFile,
    resetOnStart: true,
    backendMode: "akash",
    akash: { dryRun: true },
  });
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

test("health reports akash dry-run backend", async () => {
  const health = await json("GET", "/health");
  assert.equal(health.status, 200);
  assert.equal(health.body.backend, "akash");
  assert.equal(health.body.leaseProvider, "akash-dry-run");
});

test("BACKEND=akash dry-run: apply returns leaseId + realistic URL; list; destroy", async () => {
  await json("POST", "/admin/reset");

  const plan = await json("POST", "/plan_deployment", {
    name: "staging-api",
    gpu: "none",
    gpuCount: 1,
    image: "nginx:alpine",
  });
  assert.equal(plan.status, 200);
  const planId = plan.body.result.planId;

  const est = await json("POST", "/estimate_cost", { planId });
  assert.equal(est.status, 200);
  const proposalId = est.body.result.proposalId;
  assert.ok(est.body.result.estimate.usdPerMonth < 500);

  const pending = await json("GET", "/proposals?status=pending");
  const decision = evaluateProposal(pending.body.proposals[0] as Proposal, {
    monthlyBudgetUsd: 500,
    committedSpendUsd: 0,
  });
  assert.equal(decision.decision, "approved");

  await json("POST", `/proposals/${proposalId}/decide`, decision, {
    "x-secgate-actor": "guardian",
  });

  const apply = await json(
    "POST",
    "/apply_deployment",
    { proposalId },
    { "x-secgate-actor": "guardian" }
  );
  assert.equal(apply.status, 200);
  assert.equal(apply.body.result.status, "running");
  assert.match(apply.body.result.akashLeaseId, /^akash-dseq-\d+$/);
  assert.match(
    apply.body.result.liveUrl,
    /^https:\/\/staging-api-\d+\.ingress\.akash\.network$/
  );

  const list = await json("GET", "/list_deployments");
  assert.equal(list.body.result.deployments.length, 1);
  assert.equal(list.body.result.deployments[0].name, "staging-api");
  assert.equal(
    list.body.result.deployments[0].akashLeaseId,
    apply.body.result.akashLeaseId
  );
  assert.ok(list.body.result.committedSpendUsd < 500);

  const depId = apply.body.result.id;
  const destroy = await json(
    "POST",
    "/destroy_deployment",
    { deploymentId: depId },
    { "x-secgate-actor": "guardian" }
  );
  assert.equal(destroy.status, 200);
  assert.equal(destroy.body.result.status, "destroyed");

  const list2 = await json("GET", "/list_deployments");
  const running = list2.body.result.deployments.filter(
    (d: any) => d.status === "running"
  );
  assert.equal(running.length, 0);
  assert.equal(list2.body.result.committedSpendUsd, 0);
});

test("BACKEND=akash: 8×A100 still rejected by budget policy (table pricing)", async () => {
  await json("POST", "/admin/reset");

  const plan = await json("POST", "/plan_deployment", {
    name: "load-test-cluster",
    gpu: "A100",
    gpuCount: 8,
  });
  const est = await json("POST", "/estimate_cost", {
    planId: plan.body.result.planId,
  });
  const monthly = est.body.result.estimate.usdPerMonth;
  assert.ok(monthly >= 12000 && monthly <= 13000);
  const proposalId = est.body.result.proposalId;

  const pending = await json("GET", "/proposals?status=pending");
  const decision = evaluateProposal(pending.body.proposals[0] as Proposal, {
    monthlyBudgetUsd: 500,
    committedSpendUsd: 0,
  });
  assert.equal(decision.decision, "rejected");

  await json("POST", `/proposals/${proposalId}/decide`, decision, {
    "x-secgate-actor": "guardian",
  });

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
});

test("SDL file exists for staging-api hello-world", () => {
  const sdl = path.resolve(__dirname, "../akash/staging-api.sdl.yml");
  assert.ok(fs.existsSync(sdl), `missing ${sdl}`);
  const text = fs.readFileSync(sdl, "utf8");
  assert.match(text, /nginx:alpine/);
  assert.match(text, /version:\s*"2\.0"/);
});
