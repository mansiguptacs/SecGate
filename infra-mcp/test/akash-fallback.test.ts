import { test } from "node:test";
import assert from "node:assert/strict";
import { AkashLeaseProvider } from "../src/akash-client";
import { EventStore } from "../src/events";
import { MockBackend } from "../src/mock-backend";
import os from "os";
import path from "path";
import fs from "fs";

test("live Akash createLease falls back to dry-run when Console API is unreachable", async () => {
  process.env.AKASH_API_TIMEOUT_MS = "500";
  const provider = new AkashLeaseProvider({
    apiKey: "ac.sk.test-invalid",
    apiBaseUrl: "http://127.0.0.1:1", // connection refused
    dryRun: false,
  });
  assert.equal(provider.getMode(), "live");
  assert.equal(provider.kind, "akash-live");

  const started = Date.now();
  const lease = await provider.createLease({
    name: "staging-api",
    image: "nginx:alpine",
    gpu: "none",
    gpuCount: 1,
    replicas: 1,
    tags: { owner: "maya.chen" },
  });
  assert.ok(Date.now() - started < 3000, "fallback must fail-fast, not hang on live API");

  assert.match(lease.leaseId, /^akash-dseq-\d+$/);
  assert.match(
    lease.liveUrl,
    /^https:\/\/staging-api-\d+\.ingress\.akash\.network$/
  );
});

test("apply after live-API failure still updates committedSpendUsd", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "secgate-akash-fb-"));
  const events = new EventStore(path.join(tmp, "events.json"));
  const leases = new AkashLeaseProvider({
    apiKey: "ac.sk.test-invalid",
    apiBaseUrl: "http://127.0.0.1:1",
    dryRun: false,
  });
  const backend = new MockBackend(events, leases);

  const plan = backend.planDeployment({
    name: "staging-api",
    gpu: "none",
    gpuCount: 1,
    image: "nginx:alpine",
    tags: { owner: "maya.chen" },
  });
  const { proposalId } = backend.estimateCost(plan.planId);
  backend.decideProposal(
    proposalId,
    "approved",
    "fits budget",
    "guardian"
  );

  assert.equal(backend.committedSpendUsd(), 0);
  const dep = await backend.applyDeployment(proposalId, "guardian");
  assert.equal(dep.status, "running");
  assert.ok(backend.committedSpendUsd() > 0);
  assert.ok(backend.committedSpendUsd() < 500);

  fs.rmSync(tmp, { recursive: true, force: true });
});
