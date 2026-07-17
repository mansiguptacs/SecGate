import { test } from "node:test";
import assert from "node:assert/strict";
import { AbuseTracker } from "../src/abuse";

test("AbuseTracker quarantines after N blocked mutates", () => {
  const t = new AbuseTracker({ threshold: 3 });
  assert.equal(t.recordBlocked("dev-agent", "apply_deployment"), false);
  assert.equal(t.recordBlocked("dev-agent", "apply_deployment"), false);
  assert.equal(t.recordBlocked("dev-agent", "apply_deployment"), true);
  assert.equal(t.isQuarantined("dev-agent"), true);
  assert.equal(t.count("dev-agent"), 3);
});

test("AbuseTracker ignores non-mutate tools", () => {
  const t = new AbuseTracker({ threshold: 1 });
  assert.equal(t.recordBlocked("dev-agent", "plan_deployment"), false);
  assert.equal(t.isQuarantined("dev-agent"), false);
});
