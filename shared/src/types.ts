import type { GpuType } from "./pricing";

export type EventKind =
  | "plan"
  | "estimate"
  | "proposal"
  | "guardian_approve"
  | "guardian_reject"
  | "apply"
  | "apply_denied"
  | "destroy"
  | "list"
  | "chat"
  | "allow"
  | "blocked";

export interface SecGateEvent {
  id: string;
  ts: string;
  kind: EventKind;
  actor: string;
  message: string;
  detail?: Record<string, unknown>;
}

export type ProposalStatus = "pending" | "approved" | "rejected" | "applied" | "destroyed";

export interface DeploymentSpec {
  name: string;
  image?: string;
  gpu: GpuType;
  gpuCount: number;
  replicas?: number;
  tags?: Record<string, string>;
}

export type PricingSource = "zero" | "table";
export type BudgetSource = "nexla" | "local";

export interface CostEstimate {
  usdPerHour: number;
  usdPerMonth: number;
  breakdown: string;
  /** Where unit rates came from (Zero.xyz vs static table). */
  source?: PricingSource;
}

export interface TeamBudget {
  team: string;
  monthlyBudgetUsd: number;
  spentUsd: number;
  source: BudgetSource;
}

export interface Proposal {
  id: string;
  planId: string;
  spec: DeploymentSpec;
  estimate: CostEstimate;
  status: ProposalStatus;
  createdAt: string;
  decidedAt?: string;
  decisionReason?: string;
  actor: string;
}

export interface Deployment {
  id: string;
  proposalId: string;
  name: string;
  gpu: GpuType;
  gpuCount: number;
  usdPerMonth: number;
  status: "running" | "destroyed";
  akashLeaseId: string;
  liveUrl: string;
  createdAt: string;
  /** Last observed activity; defaults to createdAt. Used by orphan sweep. */
  lastActivityAt?: string;
  destroyedAt?: string;
  ownerTag?: string;
}

/** Runtime gate flag surfaced to Control Tower + demo director. */
export type GateMode = "on" | "off";

export interface BudgetConfig {
  monthlyBudgetUsd: number;
  team: string;
}

export interface PriceQuote {
  gpu: string;
  gpuCount: number;
  usdPerHour: number;
  usdPerMonth: number;
  breakdown: string;
  source: PricingSource;
  cached?: boolean;
}
