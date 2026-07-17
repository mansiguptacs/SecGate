import type { CostEstimate, Proposal, SecGateEvent, Deployment } from "@secgate/shared";
import { evaluateProposal } from "./policy";
import { AbuseTracker } from "./abuse";
import {
  getPriceQuote,
  type PricingProviderDeps,
} from "./pricing-provider";
import {
  getTeamBudget,
  type BudgetProviderDeps,
} from "./budget-provider";
import { findOrphans, type OrphanCriteria } from "./orphan";

const MCP_URL = process.env.SECGATE_MCP_URL ?? "http://localhost:3100";
const BUDGET = Number(process.env.SECGATE_BUDGET_USD ?? 500);
const POLL_MS = Number(process.env.SECGATE_GUARDIAN_POLL_MS ?? 1500);
const AUTO_APPLY = process.env.SECGATE_GUARDIAN_AUTO_APPLY !== "0";
const ABUSE_THRESHOLD = Number(process.env.SECGATE_ABUSE_THRESHOLD ?? 3);
const ORPHAN_IDLE_MIN = Number(process.env.SECGATE_ORPHAN_IDLE_MIN ?? 15);
const ORPHAN_SWEEP = process.env.SECGATE_ORPHAN_SWEEP !== "0";

function gatewayUrl(): string {
  return process.env.SECGATE_GATEWAY_URL ?? "";
}

function guardianToken(): string {
  return process.env.SECGATE_GUARDIAN_TOKEN ?? "guardian-agent-token-PHASE2";
}

interface ProposalsResponse {
  proposals: Proposal[];
}

interface StateResponse {
  committedSpendUsd: number;
  budgetUsd?: number;
  spentUsd?: number;
}

interface EventsResponse {
  events: SecGateEvent[];
}

export interface GuardianAdapters {
  pricing?: PricingProviderDeps;
  budget?: BudgetProviderDeps;
}

function toolBase(): string {
  return gatewayUrl() || MCP_URL;
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-secgate-actor": "guardian",
    ...(extra ?? {}),
  };
  if (gatewayUrl()) {
    headers.authorization = `Bearer ${guardianToken()}`;
  }
  return headers;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${url}: ${text}`);
  }
  return res.json() as Promise<T>;
}

function sourceSuffix(pricingSource: string, budgetSource: string): string {
  const p = pricingSource === "zero" ? "Zero" : "table";
  const b = budgetSource === "nexla" ? "Nexla" : "local";
  return ` [pricing:${p} · budget:${b}]`;
}

export async function processPendingOnce(
  baseUrl = MCP_URL,
  budgetUsd = BUDGET,
  autoApply = AUTO_APPLY,
  gwUrl = gatewayUrl(),
  adapters: GuardianAdapters = {}
): Promise<{
  reviewed: number;
  approved: number;
  rejected: number;
  lastPricingSource?: string;
  lastBudgetSource?: string;
}> {
  const { proposals } = await fetchJson<ProposalsResponse>(
    `${baseUrl}/proposals?status=pending`
  );
  const state = await fetchJson<StateResponse>(`${baseUrl}/state`);
  const teamBudget = await getTeamBudget(adapters.budget);
  const effectiveBudget = teamBudget.monthlyBudgetUsd || budgetUsd;
  let approved = 0;
  let rejected = 0;
  let lastPricingSource: string | undefined;
  let lastBudgetSource: string | undefined = teamBudget.source;
  const applyBase = gwUrl || baseUrl;

  for (const proposal of proposals) {
    const quote = await getPriceQuote(
      proposal.spec.gpu,
      proposal.spec.gpuCount,
      adapters.pricing
    );
    lastPricingSource = quote.source;

    const estimate: CostEstimate = {
      usdPerHour: quote.usdPerHour,
      usdPerMonth: quote.usdPerMonth,
      breakdown: quote.breakdown,
      source: quote.source,
    };

    const enriched: Proposal = {
      ...proposal,
      estimate,
    };

    const committed = Math.max(
      state.committedSpendUsd ?? 0,
      teamBudget.spentUsd ?? 0
    );

    const verdict = evaluateProposal(enriched, {
      monthlyBudgetUsd: effectiveBudget,
      committedSpendUsd: committed,
    });

    const reason =
      verdict.reason + sourceSuffix(quote.source, teamBudget.source);

    await fetchJson(`${baseUrl}/proposals/${proposal.id}/decide`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        decision: verdict.decision,
        reason,
        estimate,
        pricingSource: quote.source,
        budgetSource: teamBudget.source,
      }),
    });

    console.log(
      `[guardian] ${verdict.decision.toUpperCase()} ${proposal.id} (${proposal.spec.name}): ${reason}`
    );

    if (verdict.decision === "approved") {
      approved += 1;
      if (autoApply) {
        try {
          await fetchJson(`${applyBase}/apply_deployment`, {
            method: "POST",
            headers: authHeaders(),
            body: JSON.stringify({ proposalId: proposal.id }),
          });
          console.log(`[guardian] applied ${proposal.id}`);
        } catch (err) {
          console.error(`[guardian] apply failed for ${proposal.id}:`, err);
        }
      }
    } else {
      rejected += 1;
    }
  }

  return {
    reviewed: proposals.length,
    approved,
    rejected,
    lastPricingSource,
    lastBudgetSource,
  };
}

export async function quarantineIdentity(
  identity: string,
  reason: string,
  gwUrl = gatewayUrl()
): Promise<unknown> {
  if (!gwUrl) {
    throw new Error("SECGATE_GATEWAY_URL required for quarantine");
  }
  return fetchJson(`${gwUrl}/admin/quarantine`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-secgate-actor": "guardian",
      authorization: `Bearer ${guardianToken()}`,
    },
    body: JSON.stringify({ identity, reason }),
  });
}

/**
 * Scan audit events for blocked mutate attempts; quarantine when threshold hit.
 */
export async function processAbuseOnce(
  tracker: AbuseTracker,
  mcpUrl = MCP_URL,
  gwUrl = gatewayUrl(),
  seenIds: Set<string>
): Promise<{ quarantined: string[] }> {
  const quarantined: string[] = [];
  if (!gwUrl) return { quarantined };

  const data = await fetchJson<EventsResponse>(`${mcpUrl}/events`);
  for (const ev of data.events) {
    if (seenIds.has(ev.id)) continue;
    seenIds.add(ev.id);

    const tool = String(ev.detail?.tool ?? "");
    const isBlockedMutate =
      (ev.kind === "blocked" || ev.kind === "apply_denied") &&
      (tool === "apply_deployment" ||
        tool === "destroy_deployment" ||
        /apply_deployment|destroy_deployment/.test(ev.message));

    if (!isBlockedMutate) continue;
    if (ev.actor === "guardian" || ev.actor === "secgate") continue;

    const shouldQuarantine = tracker.recordBlocked(ev.actor, tool || "apply_deployment");
    if (shouldQuarantine) {
      const reason = `Repeated blocked mutate attempts (${tracker.count(ev.actor)}×) — identity quarantined by guardian`;
      try {
        await quarantineIdentity(ev.actor, reason, gwUrl);
        console.log(`[guardian] QUARANTINED ${ev.actor}: ${reason}`);
        quarantined.push(ev.actor);
      } catch (err) {
        console.error(`[guardian] quarantine failed for ${ev.actor}:`, err);
      }
    }
  }
  return { quarantined };
}

interface ListDeploymentsResponse {
  ok?: boolean;
  result?: {
    deployments: Deployment[];
    committedSpendUsd?: number;
  };
  deployments?: Deployment[];
}

/**
 * Destroy idle or untagged deployments via guardian identity (orphan sweep).
 */
export async function processOrphanSweepOnce(
  mcpUrl = MCP_URL,
  gwUrl = gatewayUrl(),
  criteria: OrphanCriteria = {
    idleMinutes: ORPHAN_IDLE_MIN,
    untaggedIsOrphan: true,
  }
): Promise<{ destroyed: string[]; orphansFound: number }> {
  const destroyed: string[] = [];
  const applyBase = gwUrl || mcpUrl;

  let deployments: Deployment[] = [];
  try {
    const listed = await fetchJson<ListDeploymentsResponse>(
      `${mcpUrl}/list_deployments`,
      { headers: authHeaders() }
    );
    deployments =
      listed.result?.deployments ??
      listed.deployments ??
      [];
  } catch {
    const state = await fetchJson<{ deployments: Deployment[] }>(
      `${mcpUrl}/state`
    );
    deployments = (state.deployments ?? []).filter((d) => d.status === "running");
  }

  const running = deployments.filter((d) => d.status === "running");
  // Skip sweep while AgentFence is OFF (cold-open disaster must stay on screen)
  try {
    const gateRes = await fetchJson<{ gate?: string }>(`${mcpUrl}/admin/gate`);
    if (gateRes.gate === "off") {
      return { destroyed: [], orphansFound: 0 };
    }
  } catch {
    /* older servers without /admin/gate — continue */
  }

  const orphans = findOrphans(running, criteria);

  for (const orphan of orphans) {
    try {
      await fetchJson(`${applyBase}/destroy_deployment`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ deploymentId: orphan.id }),
      });
      console.log(
        `[guardian] ORPHAN destroyed ${orphan.id} (${orphan.name}) — idle/untagged, freed $${orphan.usdPerMonth}/mo`
      );
      destroyed.push(orphan.id);
    } catch (err) {
      console.error(`[guardian] orphan destroy failed for ${orphan.id}:`, err);
    }
  }

  return { destroyed, orphansFound: orphans.length };
}

async function loop(): Promise<void> {
  const tracker = new AbuseTracker({ threshold: ABUSE_THRESHOLD });
  const seenIds = new Set<string>();
  const budget = await getTeamBudget();
  console.log(
    `[guardian] watching mcp=${MCP_URL} gateway=${gatewayUrl() || "(none)"} budget=$${budget.monthlyBudgetUsd}/mo (${budget.source}) poll=${POLL_MS}ms abuse_threshold=${ABUSE_THRESHOLD} orphan_idle=${ORPHAN_IDLE_MIN}min sweep=${ORPHAN_SWEEP}`
  );
  for (;;) {
    try {
      await processPendingOnce();
      await processAbuseOnce(tracker, MCP_URL, gatewayUrl(), seenIds);
      if (ORPHAN_SWEEP) {
        await processOrphanSweepOnce();
      }
    } catch (err) {
      console.error("[guardian] poll error:", (err as Error).message);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

if (require.main === module) {
  loop().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { evaluateProposal, AbuseTracker };
export { toolBase, authHeaders };
export {
  getPriceQuote,
  tableQuote,
  clearPricingCache,
  parseHourlyFromZeroOutput,
  zeroSearchFoundCapabilities,
} from "./pricing-provider";
export { getTeamBudget, loadLocalBudget, fetchNexlaBudget } from "./budget-provider";
export { findOrphans, isOrphan } from "./orphan";
// processOrphanSweepOnce already exported above
