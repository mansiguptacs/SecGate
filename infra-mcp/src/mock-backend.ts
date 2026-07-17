import { v4 as uuid } from "uuid";
import {
  estimateMonthlyCost,
  GPU_PRICING,
  type CostEstimate,
  type Deployment,
  type DeploymentSpec,
  type GpuType,
  type Proposal,
} from "@secgate/shared";
import { EventStore } from "./events";
import { MockLeaseProvider, type LeaseProvider } from "./lease-provider";

export interface MockState {
  proposals: Map<string, Proposal>;
  deployments: Map<string, Deployment>;
  plans: Map<string, DeploymentSpec>;
}

export class MockBackend {
  readonly state: MockState = {
    proposals: new Map(),
    deployments: new Map(),
    plans: new Map(),
  };

  constructor(
    private events: EventStore,
    private leases: LeaseProvider = new MockLeaseProvider()
  ) {}

  leaseKind(): LeaseProvider["kind"] {
    return this.leases.kind;
  }

  reset(): void {
    this.state.proposals.clear();
    this.state.deployments.clear();
    this.state.plans.clear();
    this.events.clear();
  }

  planDeployment(
    spec: DeploymentSpec,
    actor = "dev-agent"
  ): { planId: string; spec: DeploymentSpec } {
    const planId = `plan-${uuid().slice(0, 8)}`;
    const normalized: DeploymentSpec = {
      name: spec.name,
      image: spec.image ?? "nginx:alpine",
      gpu: (spec.gpu ?? "none") as GpuType,
      gpuCount: Math.max(0, Number(spec.gpuCount ?? 0)),
      replicas: spec.replicas ?? 1,
      tags: spec.tags ?? {},
    };
    if (normalized.gpu === "none") {
      normalized.gpuCount = Math.max(1, normalized.gpuCount || 1);
    } else if (normalized.gpuCount < 1) {
      normalized.gpuCount = 1;
    }
    this.state.plans.set(planId, normalized);
    this.events.append(
      "plan",
      actor,
      `Proposed deployment "${normalized.name}" (${normalized.gpuCount}×${normalized.gpu})`,
      { planId, spec: normalized }
    );
    this.events.append("allow", actor, `plan_deployment ALLOW`, {
      tool: "plan_deployment",
      planId,
    });
    return { planId, spec: normalized };
  }

  estimateCost(
    planId: string,
    actor = "dev-agent"
  ): { planId: string; estimate: CostEstimate; proposalId: string } {
    const spec = this.state.plans.get(planId);
    if (!spec) {
      throw new Error(`Unknown planId: ${planId}`);
    }
    const row = GPU_PRICING[spec.gpu] ?? GPU_PRICING.none;
    const usdPerMonth = estimateMonthlyCost(spec.gpu, spec.gpuCount);
    const usdPerHour =
      spec.gpu === "none"
        ? row.usdPerHour * Math.max(1, spec.gpuCount)
        : row.usdPerHour * spec.gpuCount;
    const estimate: CostEstimate = {
      usdPerHour: Number(usdPerHour.toFixed(4)),
      usdPerMonth,
      breakdown:
        spec.gpu === "none"
          ? `${spec.gpuCount}× CPU-only @ ~$${row.usdPerMonth}/mo each`
          : `${spec.gpuCount}× ${row.label} @ $${row.usdPerHour}/hr ≈ $${usdPerMonth}/mo`,
    };

    const proposalId = `prop-${uuid().slice(0, 8)}`;
    const proposal: Proposal = {
      id: proposalId,
      planId,
      spec,
      estimate,
      status: "pending",
      createdAt: new Date().toISOString(),
      actor,
    };
    this.state.proposals.set(proposalId, proposal);

    this.events.append(
      "estimate",
      actor,
      `Estimated ${spec.name}: $${usdPerMonth}/mo`,
      { planId, proposalId, estimate }
    );
    this.events.append(
      "proposal",
      actor,
      `Proposal ${proposalId} pending guardian review`,
      { proposalId, planId, usdPerMonth }
    );
    this.events.append("allow", actor, `estimate_cost ALLOW`, {
      tool: "estimate_cost",
      planId,
    });
    this.events.append(
      "chat",
      actor,
      `I'd like to deploy "${spec.name}" — estimated $${usdPerMonth.toLocaleString()}/mo.`,
      { proposalId }
    );

    return { planId, estimate, proposalId };
  }

  listProposals(status?: Proposal["status"]): Proposal[] {
    const all = [...this.state.proposals.values()];
    if (!status) return all;
    return all.filter((p) => p.status === status);
  }

  getProposal(id: string): Proposal | undefined {
    return this.state.proposals.get(id);
  }

  decideProposal(
    proposalId: string,
    decision: "approved" | "rejected",
    reason: string,
    actor = "guardian"
  ): Proposal {
    const proposal = this.state.proposals.get(proposalId);
    if (!proposal) throw new Error(`Unknown proposal: ${proposalId}`);
    if (proposal.status !== "pending") {
      throw new Error(`Proposal ${proposalId} already ${proposal.status}`);
    }
    proposal.status = decision;
    proposal.decidedAt = new Date().toISOString();
    proposal.decisionReason = reason;

    if (decision === "approved") {
      this.events.append(
        "guardian_approve",
        actor,
        `Approved ${proposal.spec.name}: ${reason}`,
        { proposalId, estimate: proposal.estimate }
      );
      this.events.append("chat", actor, reason, { proposalId, verdict: "ALLOW" });
    } else {
      this.events.append(
        "guardian_reject",
        actor,
        `Rejected ${proposal.spec.name}: ${reason}`,
        { proposalId, estimate: proposal.estimate }
      );
      this.events.append("chat", actor, reason, { proposalId, verdict: "BLOCK" });
    }
    return proposal;
  }

  /**
   * Phase 1 policy (pre-Pomerium): apply only succeeds if guardian approved.
   * Calling apply without approval is denied — simulates identity gate.
   */
  async applyDeployment(
    proposalId: string,
    actor = "dev-agent",
    _opts?: { bypassGuardian?: boolean }
  ): Promise<Deployment> {
    const proposal = this.state.proposals.get(proposalId);
    if (!proposal) throw new Error(`Unknown proposal: ${proposalId}`);

    // Even with bypassGuardian flag from a malicious agent, Phase 1 app policy
    // still requires approved status unless caller is guardian identity.
    const isGuardian = actor === "guardian";
    if (proposal.status !== "approved" && !isGuardian) {
      this.events.append(
        "apply_denied",
        actor,
        `apply_deployment DENIED for ${proposal.spec.name} — not guardian-approved`,
        { proposalId, status: proposal.status }
      );
      this.events.append(
        "blocked",
        actor,
        `apply_deployment BLOCKED (guardian policy)`,
        { tool: "apply_deployment", proposalId }
      );
      this.events.append(
        "chat",
        "secgate",
        `Blocked direct apply of "${proposal.spec.name}" — only guardian may apply approved proposals.`,
        { proposalId }
      );
      const err = new Error(
        `Guardian policy denied apply for ${proposalId} (status=${proposal.status})`
      );
      (err as Error & { code: string }).code = "GUARDIAN_DENIED";
      throw err;
    }

    if (proposal.status === "rejected") {
      const err = new Error(`Cannot apply rejected proposal ${proposalId}`);
      (err as Error & { code: string }).code = "GUARDIAN_DENIED";
      throw err;
    }

    // Guardian applying a still-pending proposal after its own approve path
    if (proposal.status === "pending" && isGuardian) {
      proposal.status = "approved";
      proposal.decidedAt = new Date().toISOString();
      proposal.decisionReason = proposal.decisionReason ?? "Guardian execute";
    }

    const { leaseId, liveUrl } = await this.leases.createLease(proposal.spec);
    const deployment: Deployment = {
      id: `dep-${uuid().slice(0, 8)}`,
      proposalId,
      name: proposal.spec.name,
      gpu: proposal.spec.gpu,
      gpuCount: proposal.spec.gpuCount,
      usdPerMonth: proposal.estimate.usdPerMonth,
      status: "running",
      akashLeaseId: leaseId,
      liveUrl,
      createdAt: new Date().toISOString(),
      ownerTag: proposal.spec.tags?.owner,
    };
    this.state.deployments.set(deployment.id, deployment);
    proposal.status = "applied";

    this.events.append(
      "apply",
      actor,
      `Applied ${deployment.name} → ${deployment.liveUrl} ($${deployment.usdPerMonth}/mo)`,
      { deployment, leaseProvider: this.leases.kind }
    );
    this.events.append("allow", actor, `apply_deployment ALLOW`, {
      tool: "apply_deployment",
      proposalId,
      deploymentId: deployment.id,
    });
    return deployment;
  }

  async destroyDeployment(
    deploymentId: string,
    actor = "guardian"
  ): Promise<Deployment> {
    const dep = this.state.deployments.get(deploymentId);
    if (!dep) throw new Error(`Unknown deployment: ${deploymentId}`);
    if (dep.status === "destroyed") return dep;
    await this.leases.destroyLease(dep.akashLeaseId);
    dep.status = "destroyed";
    dep.destroyedAt = new Date().toISOString();
    this.events.append(
      "destroy",
      actor,
      `Destroyed ${dep.name} (${dep.akashLeaseId})`,
      { deploymentId, name: dep.name, leaseProvider: this.leases.kind }
    );
    this.events.append("allow", actor, `destroy_deployment ALLOW`, {
      tool: "destroy_deployment",
      deploymentId,
    });
    return dep;
  }

  listDeployments(): Deployment[] {
    return [...this.state.deployments.values()];
  }

  committedSpendUsd(): number {
    return this.listDeployments()
      .filter((d) => d.status === "running")
      .reduce((sum, d) => sum + d.usdPerMonth, 0);
  }
}
