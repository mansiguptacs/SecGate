import { test } from "node:test";
import assert from "node:assert/strict";
import { findOrphans, isOrphan } from "../src/orphan";
import type { Deployment } from "@secgate/shared";

function dep(partial: Partial<Deployment> & { id: string; name: string }): Deployment {
  const now = new Date().toISOString();
  return {
    proposalId: "prop-x",
    gpu: "none",
    gpuCount: 1,
    usdPerMonth: 48,
    status: "running",
    akashLeaseId: "lease-x",
    liveUrl: "https://example.test",
    createdAt: now,
    lastActivityAt: now,
    ...partial,
  };
}

test("untagged running deployment is orphan", () => {
  const d = dep({ id: "1", name: "old", ownerTag: undefined });
  assert.equal(isOrphan(d, { idleMinutes: 60, untaggedIsOrphan: true }), true);
});

test("tagged fresh deployment is not orphan", () => {
  const d = dep({
    id: "2",
    name: "staging",
    ownerTag: "maya.chen",
    createdAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
  });
  assert.equal(isOrphan(d, { idleMinutes: 15, untaggedIsOrphan: true }), false);
});

test("idle tagged deployment is orphan", () => {
  const idle = new Date(Date.now() - 20 * 60_000).toISOString();
  const d = dep({
    id: "3",
    name: "idle",
    ownerTag: "maya.chen",
    createdAt: idle,
    lastActivityAt: idle,
  });
  assert.equal(isOrphan(d, { idleMinutes: 15 }), true);
});

test("findOrphans filters destroyed", () => {
  const idle = new Date(Date.now() - 30 * 60_000).toISOString();
  const list = [
    dep({ id: "a", name: "orphan", ownerTag: undefined }),
    dep({
      id: "b",
      name: "gone",
      status: "destroyed",
      ownerTag: undefined,
      createdAt: idle,
      lastActivityAt: idle,
    }),
    dep({
      id: "c",
      name: "ok",
      ownerTag: "owner",
      createdAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
    }),
  ];
  const orphans = findOrphans(list, { idleMinutes: 15 });
  assert.deepEqual(
    orphans.map((o) => o.id),
    ["a"]
  );
});
