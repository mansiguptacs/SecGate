import type { Proposal } from "@secgate/shared";
import { evaluateProposal } from "./policy";

const MCP_URL = process.env.SECGATE_MCP_URL ?? "http://localhost:3100";
const BUDGET = Number(process.env.SECGATE_BUDGET_USD ?? 500);
const POLL_MS = Number(process.env.SECGATE_GUARDIAN_POLL_MS ?? 1500);
const AUTO_APPLY = process.env.SECGATE_GUARDIAN_AUTO_APPLY !== "0";

interface ProposalsResponse {
  proposals: Proposal[];
}

interface StateResponse {
  committedSpendUsd: number;
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
  autoApply = AUTO_APPLY
): Promise<{ reviewed: number; approved: number; rejected: number }> {
  const { proposals } = await fetchJson<ProposalsResponse>(
    `${baseUrl}/proposals?status=pending`
  );
  const state = await fetchJson<StateResponse>(`${baseUrl}/state`);
  let approved = 0;
  let rejected = 0;

  for (const proposal of proposals) {
    const verdict = evaluateProposal(proposal, {
      monthlyBudgetUsd: budgetUsd,
      committedSpendUsd: state.committedSpendUsd,
    });

    await fetchJson(`${baseUrl}/proposals/${proposal.id}/decide`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-secgate-actor": "guardian",
      },
      body: JSON.stringify(verdict),
    });

    console.log(
      `[guardian] ${verdict.decision.toUpperCase()} ${proposal.id} (${proposal.spec.name}): ${verdict.reason}`
    );

    if (verdict.decision === "approved") {
      approved += 1;
      if (autoApply) {
        try {
          await fetchJson(`${baseUrl}/apply_deployment`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-secgate-actor": "guardian",
            },
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

async function loop(): Promise<void> {
  console.log(`[guardian] watching ${MCP_URL} budget=$${BUDGET}/mo poll=${POLL_MS}ms`);
  for (;;) {
    try {
      await processPendingOnce();
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

export { evaluateProposal };
