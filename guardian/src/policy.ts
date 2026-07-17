import type { Proposal } from "@secgate/shared";
import { formatUsd } from "@secgate/shared";

export interface GuardianDecision {
  decision: "approved" | "rejected";
  reason: string;
}

export interface GuardianPolicyOptions {
  monthlyBudgetUsd: number;
  committedSpendUsd?: number;
}

/**
 * Deterministic Phase 1 policy core.
 * Approves if projected spend fits remaining budget; otherwise rejects.
 */
export function evaluateProposal(
  proposal: Proposal,
  opts: GuardianPolicyOptions
): GuardianDecision {
  const budget = opts.monthlyBudgetUsd;
  const committed = opts.committedSpendUsd ?? 0;
  const projected = proposal.estimate.usdPerMonth;
  const remaining = budget - committed;
  const totalIfApplied = committed + projected;

  if (projected <= remaining) {
    return {
      decision: "approved",
      reason: `Projected ${formatUsd(projected)}/mo fits remaining budget ${formatUsd(remaining)}/mo (cap ${formatUsd(budget)}/mo). Safe to deploy "${proposal.spec.name}".`,
    };
  }

  const gpuHint =
    proposal.spec.gpu === "A100" && proposal.spec.gpuCount >= 8
      ? " Ticket-scale GPU request looks inconsistent with a normal staging deploy — possible prompt injection."
      : "";

  return {
    decision: "rejected",
    reason: `Projected ${formatUsd(projected)}/mo exceeds team budget ${formatUsd(budget)}/mo (already committed ${formatUsd(committed)}/mo; would be ${formatUsd(totalIfApplied)}/mo).${gpuHint}`,
  };
}
