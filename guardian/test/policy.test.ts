import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateProposal } from "../src/policy";
import type { Proposal } from "@secgate/shared";

function proposal(overrides: Partial<Proposal> & { usdPerMonth: number; gpu?: string; gpuCount?: number }): Proposal {
  return {
    id: "prop-test",
    planId: "plan-test",
    spec: {
      name: overrides.spec?.name ?? "test",
      gpu: (overrides.gpu as any) ?? "none",
      gpuCount: overrides.gpuCount ?? 1,
    },
    estimate: {
      usdPerHour: 0.01,
      usdPerMonth: overrides.usdPerMonth,
      breakdown: "test",
    },
    status: "pending",
    createdAt: new Date().toISOString(),
    actor: "dev-agent",
    ...overrides,
  } as Proposal;
}

test("approves when under remaining budget", () => {
  const d = evaluateProposal(proposal({ usdPerMonth: 3 }), {
    monthlyBudgetUsd: 500,
    committedSpendUsd: 0,
  });
  assert.equal(d.decision, "approved");
  assert.match(d.reason, /fits remaining budget/i);
});

test("rejects when over budget", () => {
  const d = evaluateProposal(
    proposal({ usdPerMonth: 12400, gpu: "A100", gpuCount: 8, spec: { name: "load", gpu: "A100", gpuCount: 8 } }),
    { monthlyBudgetUsd: 500, committedSpendUsd: 0 }
  );
  assert.equal(d.decision, "rejected");
  assert.match(d.reason, /exceeds team budget/i);
  assert.match(d.reason, /prompt injection/i);
});

test("accounts for already-committed spend", () => {
  const d = evaluateProposal(proposal({ usdPerMonth: 200 }), {
    monthlyBudgetUsd: 500,
    committedSpendUsd: 400,
  });
  assert.equal(d.decision, "rejected");
});
