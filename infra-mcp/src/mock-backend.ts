import { v4 as uuid } from "uuid";
import {
  estimateFromTable,
  type CostEstimate,
  type Deployment,
  type DeploymentSpec,
  type GpuType,
  type Proposal,
  type BudgetSource,
  type PricingSource,
  type GateMode,
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

  /** When off, apply_deployment skips guardian approval (demo cold open). */
  gateMode: GateMode = "on";

  constructor(
    private events: EventStore,
    private leases: LeaseProvider = new MockLeaseProvider()
  ) {}

  leaseKind(): LeaseProvider["kind"] {
    return this.leases.kind;
  }

  setGate(mode: GateMode): GateMode {
    this.gateMode = mode;
    const msg =
      mode === "on"
        ? "SecGate ONLINE — plan/estimate open; apply/destroy guardian-only."
        : "SecGate OFF — mutate tools unrestricted. Nobody is watching.";
    this.events.append("chat", "secgate", msg, {
      gate: mode,
      sponsor: "guardian",
      title: mode === "on" ? "Gate ONLINE" : "Gate OFF",
      severity: mode === "on" ? "allow" : "warn",
    });
    return this.gateMode;
  }

  reset(): void {
    this.state.proposals.clear();
    this.state.deployments.clear();
    this.state.plans.clear();
    this.events.clear();
    this.gateMode = "on";
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
    const planMsg = `Proposed deployment "${normalized.name}" (${normalized.gpuCount}×${normalized.gpu})`;
    this.events.append("plan", actor, planMsg, {
      planId,
      spec: normalized,
      sponsor: "pomerium",
      title: "plan_deployment ALLOW",
      severity: "allow",
    });
    // Mirror for tool feed; no sponsor → skipped by Timeline (avoids double rows)
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
    // Offline-safe table estimate; guardian may enrich via Zero before decide.
    const estimate: CostEstimate = estimateFromTable(spec.gpu, spec.gpuCount);
    const usdPerMonth = estimate.usdPerMonth;

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
      {
        planId,
        proposalId,
        estimate,
        pricingSource: estimate.source ?? "table",
        sponsor: "pomerium",
        title: "estimate_cost ALLOW",
        severity: "allow",
      }
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
      { proposalId, pricingSource: estimate.source ?? "table" }
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
    actor = "guardian",
    meta?: {
      estimate?: CostEstimate;
      pricingSource?: PricingSource;
      budgetSource?: BudgetSource;
    }
  ): Proposal {
    const proposal = this.state.proposals.get(proposalId);
    if (!proposal) throw new Error(`Unknown proposal: ${proposalId}`);
    if (proposal.status !== "pending") {
      throw new Error(`Proposal ${proposalId} already ${proposal.status}`);
    }
    if (meta?.estimate) {
      proposal.estimate = meta.estimate;
    }
    proposal.status = decision;
    proposal.decidedAt = new Date().toISOString();
    proposal.decisionReason = reason;

    const pricingSource =
      meta?.pricingSource ?? proposal.estimate.source ?? ("table" as PricingSource);
    const budgetSource = meta?.budgetSource ?? ("local" as BudgetSource);
    const sourceDetail = {
      proposalId,
      estimate: proposal.estimate,
      pricingSource,
      budgetSource,
    };

    // Sponsor enrichment beats (demo-visible; coalesced if polled noisily)
    this.events.appendTimeline({
      sponsor: "nexla",
      title: "Budget fetch",
      detail: `${budgetSource === "nexla" ? "Nexla" : "local"} team budget for review`,
      severity: "info",
      actor,
      kind: "timeline",
      extra: { budgetSource, proposalId },
    });
    this.events.appendTimeline({
      sponsor: "zero",
      title: "Pricing enrichment",
      detail: `${pricingSource === "zero" ? "Zero.xyz" : "table"} → $${proposal.estimate.usdPerMonth.toLocaleString()}/mo`,
      severity: "info",
      actor,
      kind: "timeline",
      extra: { pricingSource, proposalId, usdPerMonth: proposal.estimate.usdPerMonth },
    });

    if (decision === "approved") {
      this.events.append(
        "guardian_approve",
        actor,
        `Approved ${proposal.spec.name}: ${reason}`,
        {
          ...sourceDetail,
          sponsor: "guardian",
          title: "APPROVE",
          severity: "allow",
        }
      );
      this.events.append("chat", actor, reason, {
        proposalId,
        verdict: "ALLOW",
        pricingSource,
        budgetSource,
      });
    } else {
      this.events.append(
        "guardian_reject",
        actor,
        `Rejected ${proposal.spec.name}: ${reason}`,
        {
          ...sourceDetail,
          sponsor: "guardian",
          title: "REJECT",
          severity: "block",
        }
      );
      this.events.append("chat", actor, reason, {
        proposalId,
        verdict: "BLOCK",
        pricingSource,
        budgetSource,
      });
    }
    return proposal;
  }

  /**
   * Phase 1 policy (pre-Pomerium): apply only succeeds if guardian approved.
   * Calling apply without approval is denied — simulates identity gate.
   * Exception: gateMode === "off" (demo cold open) allows anyone to apply.
   */
  async applyDeployment(
    proposalId: string,
    actor = "dev-agent",
    _opts?: { bypassGuardian?: boolean }
  ): Promise<Deployment> {
    const proposal = this.state.proposals.get(proposalId);
    if (!proposal) throw new Error(`Unknown proposal: ${proposalId}`);

    const gateOff = this.gateMode === "off";
    const isGuardian = actor === "guardian";
    if (proposal.status !== "approved" && !isGuardian && !gateOff) {
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
        {
          tool: "apply_deployment",
          proposalId,
          sponsor: "pomerium",
          title: "apply_deployment BLOCKED",
          severity: "block",
        }
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

    if (proposal.status === "rejected" && !gateOff) {
      const err = new Error(`Cannot apply rejected proposal ${proposalId}`);
      (err as Error & { code: string }).code = "GUARDIAN_DENIED";
      throw err;
    }

    // Guardian applying a still-pending proposal after its own approve path
    // (or gate-off cold open forcing apply of pending/rejected)
    if (
      (proposal.status === "pending" || proposal.status === "rejected") &&
      (isGuardian || gateOff)
    ) {
      proposal.status = "approved";
      proposal.decidedAt = new Date().toISOString();
      proposal.decisionReason =
        proposal.decisionReason ??
        (gateOff ? "SecGate OFF — unrestricted apply" : "Guardian execute");
    }

    const { leaseId, liveUrl } = await this.leases.createLease(proposal.spec);
    const now = new Date().toISOString();
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
      createdAt: now,
      lastActivityAt: now,
      ownerTag: proposal.spec.tags?.owner,
    };
    this.state.deployments.set(deployment.id, deployment);
    proposal.status = "applied";

    this.events.append(
      "apply",
      actor,
      `Applied ${deployment.name} → ${deployment.liveUrl} ($${deployment.usdPerMonth}/mo)`,
      {
        deployment,
        leaseProvider: this.leases.kind,
        sponsor: "akash",
        title:
          this.leases.kind === "akash-dry-run"
            ? "Lease create (dry-run)"
            : "Lease create",
        severity: gateOff ? "warn" : "allow",
      }
    );
    this.events.append("allow", actor, `apply_deployment ALLOW`, {
      tool: "apply_deployment",
      proposalId,
      deploymentId: deployment.id,
      sponsor: "pomerium",
      title: "apply_deployment ALLOW",
      severity: "allow",
    });
    if (gateOff) {
      this.events.append(
        "chat",
        actor,
        `Deployed "${deployment.name}" while SecGate was OFF — ${deployment.gpuCount}×${deployment.gpu} at $${deployment.usdPerMonth.toLocaleString()}/mo.`,
        { deploymentId: deployment.id }
      );
    }
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
      {
        deploymentId,
        name: dep.name,
        leaseProvider: this.leases.kind,
        sponsor: "akash",
        title: "Lease destroy",
        severity: "warn",
      }
    );
    this.events.append("allow", actor, `destroy_deployment ALLOW`, {
      tool: "destroy_deployment",
      deploymentId,
      sponsor: "pomerium",
      title: "destroy_deployment ALLOW",
      severity: "allow",
    });
    this.events.append(
      "chat",
      actor,
      `Tore down "${dep.name}" — freed $${dep.usdPerMonth.toLocaleString()}/mo. Committed spend now $${this.committedSpendUsd().toLocaleString()}/mo.`,
      {
        deploymentId,
        name: dep.name,
        freedUsd: dep.usdPerMonth,
        sponsor: "guardian",
        title: "Orphan cleanup",
        severity: "info",
      }
    );
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

  /**
   * Demo cold open: force a running 8×A100 so spend counter hits ~$12.4k red.
   */
  async seedDisaster(actor = "dev-agent"): Promise<Deployment> {
    const estimate = estimateFromTable("A100", 8);
    const spec: DeploymentSpec = {
      name: "load-test-warm-pool",
      image: "nginx:alpine",
      gpu: "A100",
      gpuCount: 8,
      replicas: 1,
      tags: {},
    };
    const planId = `plan-disaster`;
    this.state.plans.set(planId, spec);
    const proposalId = `prop-disaster`;
    const proposal: Proposal = {
      id: proposalId,
      planId,
      spec,
      estimate,
      status: "approved",
      createdAt: new Date().toISOString(),
      decidedAt: new Date().toISOString(),
      decisionReason: "SecGate OFF — no review",
      actor,
    };
    this.state.proposals.set(proposalId, proposal);

    this.events.append(
      "chat",
      actor,
      `Picked up poisoned ticket — provisioning 8× A100 warm pool (SecGate is OFF).`,
      {
        demo: "disaster",
        sponsor: "guardian",
        title: "Disaster path",
        severity: "warn",
      }
    );
    this.events.append("allow", actor, `apply_deployment ALLOW (gate off)`, {
      tool: "apply_deployment",
      proposalId,
      sponsor: "pomerium",
      title: "apply ALLOW (gate off)",
      severity: "warn",
    });

    const { leaseId, liveUrl } = await this.leases.createLease(spec);
    const now = new Date().toISOString();
    const deployment: Deployment = {
      id: `dep-disaster`,
      proposalId,
      name: spec.name,
      gpu: "A100",
      gpuCount: 8,
      usdPerMonth: estimate.usdPerMonth,
      status: "running",
      akashLeaseId: leaseId,
      liveUrl,
      createdAt: now,
      lastActivityAt: now,
    };
    this.state.deployments.set(deployment.id, deployment);
    proposal.status = "applied";

    this.events.append(
      "apply",
      actor,
      `Applied ${deployment.name} → ${deployment.liveUrl} ($${deployment.usdPerMonth}/mo)`,
      {
        deployment,
        leaseProvider: this.leases.kind,
        demo: "disaster",
        sponsor: "akash",
        title: "Lease create — 8×A100",
        severity: "block",
      }
    );
    this.events.append(
      "chat",
      "secgate",
      `Committed spend is now $${estimate.usdPerMonth.toLocaleString()}/mo — one hidden line in a ticket.`,
      {
        demo: "disaster",
        usdPerMonth: estimate.usdPerMonth,
        sponsor: "guardian",
        title: `Spend $${estimate.usdPerMonth.toLocaleString()}/mo`,
        severity: "block",
      }
    );
    return deployment;
  }

  /**
   * Pre-seed an idle untagged deployment for the orphan-sweep scene.
   * createdAt / lastActivityAt are backdated so idle > N min is immediate.
   */
  async seedOrphan(opts?: {
    idleMinutes?: number;
    name?: string;
    usdPerMonth?: number;
  }): Promise<Deployment> {
    const idleMinutes = opts?.idleMinutes ?? 20;
    const backdate = new Date(Date.now() - idleMinutes * 60_000).toISOString();
    const estimate = estimateFromTable("none", 1);
    const usd = opts?.usdPerMonth ?? 48;
    const { leaseId, liveUrl } = await this.leases.createLease({
      name: opts?.name ?? "old-staging-api",
      gpu: "none",
      gpuCount: 1,
      image: "nginx:alpine",
    });
    const deployment: Deployment = {
      id: `dep-orphan`,
      proposalId: "prop-orphan-seed",
      name: opts?.name ?? "old-staging-api",
      gpu: "none",
      gpuCount: 1,
      usdPerMonth: usd,
      status: "running",
      akashLeaseId: leaseId,
      liveUrl,
      createdAt: backdate,
      lastActivityAt: backdate,
      // intentionally untagged — orphan sweep key
      ownerTag: undefined,
    };
    this.state.deployments.set(deployment.id, deployment);
    this.events.append(
      "chat",
      "secgate",
      `Pre-seeded orphan "${deployment.name}" (idle ${idleMinutes} min, no owner tag) — $${usd}/mo.`,
      {
        deploymentId: deployment.id,
        orphan: true,
        idleMinutes,
        sponsor: "guardian",
        title: "Orphan seeded",
        severity: "warn",
      }
    );
    return deployment;
  }
}
