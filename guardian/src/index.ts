import type { Proposal, SecGateEvent } from "@secgate/shared";
import { evaluateProposal } from "./policy";
import { AbuseTracker } from "./abuse";

const MCP_URL = process.env.SECGATE_MCP_URL ?? "http://localhost:3100";
const BUDGET = Number(process.env.SECGATE_BUDGET_USD ?? 500);
const POLL_MS = Number(process.env.SECGATE_GUARDIAN_POLL_MS ?? 1500);
const AUTO_APPLY = process.env.SECGATE_GUARDIAN_AUTO_APPLY !== "0";
const ABUSE_THRESHOLD = Number(process.env.SECGATE_ABUSE_THRESHOLD ?? 3);

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
}

interface EventsResponse {
  events: SecGateEvent[];
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

export async function processPendingOnce(
  baseUrl = MCP_URL,
  budgetUsd = BUDGET,
  autoApply = AUTO_APPLY,
  gwUrl = gatewayUrl()
): Promise<{ reviewed: number; approved: number; rejected: number }> {
  const { proposals } = await fetchJson<ProposalsResponse>(
    `${baseUrl}/proposals?status=pending`
  );
  const state = await fetchJson<StateResponse>(`${baseUrl}/state`);
  let approved = 0;
  let rejected = 0;
  const applyBase = gwUrl || baseUrl;

  for (const proposal of proposals) {
    const verdict = evaluateProposal(proposal, {
      monthlyBudgetUsd: budgetUsd,
      committedSpendUsd: state.committedSpendUsd,
    });

    await fetchJson(`${baseUrl}/proposals/${proposal.id}/decide`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(verdict),
    });

    console.log(
      `[guardian] ${verdict.decision.toUpperCase()} ${proposal.id} (${proposal.spec.name}): ${verdict.reason}`
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

  return { reviewed: proposals.length, approved, rejected };
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

async function loop(): Promise<void> {
  const tracker = new AbuseTracker({ threshold: ABUSE_THRESHOLD });
  const seenIds = new Set<string>();
  console.log(
    `[guardian] watching mcp=${MCP_URL} gateway=${gatewayUrl() || "(none)"} budget=$${BUDGET}/mo poll=${POLL_MS}ms abuse_threshold=${ABUSE_THRESHOLD}`
  );
  for (;;) {
    try {
      await processPendingOnce();
      await processAbuseOnce(tracker, MCP_URL, gatewayUrl(), seenIds);
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
