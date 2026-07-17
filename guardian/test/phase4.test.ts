/**
 * Phase 4 — Zero.xyz pricing + Nexla budget adapters (with offline fallbacks).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "http";
import os from "os";
import path from "path";
import fs from "fs";
import { createApp } from "../../infra-mcp/src/server";
import {
  processPendingOnce,
  getPriceQuote,
  tableQuote,
  clearPricingCache,
  parseHourlyFromZeroOutput,
  getTeamBudget,
  loadLocalBudget,
} from "../src/index";
import type { Proposal } from "@secgate/shared";
import { evaluateProposal } from "../src/policy";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "secgate-phase4-"));
const eventsFile = path.join(tmpDir, "events.json");
const budgetFile = path.join(tmpDir, "budget.json");

fs.writeFileSync(
  budgetFile,
  JSON.stringify({
    team: "platform-eng",
    monthly_budget_usd: 500,
    spent_usd: 0,
  })
);

test("offline: table quote for 8×A100 is ~$12.4k", () => {
  const q = tableQuote("A100", 8);
  assert.equal(q.source, "table");
  assert.ok(q.usdPerMonth >= 12000 && q.usdPerMonth <= 13000);
});

test("offline: local budget.json loads $500 cap", () => {
  const b = loadLocalBudget(budgetFile);
  assert.equal(b.source, "local");
  assert.equal(b.monthlyBudgetUsd, 500);
  assert.equal(b.team, "platform-eng");
});

test("parseHourlyFromZeroOutput extracts $/hr near GPU table", () => {
  const text = `1. Cloud GPU rates\nNVIDIA A100 80GB — $2.20/hr on provider X\nAlso a $0.01/hr fee for API calls`;
  const n = parseHourlyFromZeroOutput(text, "A100");
  assert.ok(n != null);
  assert.ok(Math.abs(n! - 2.2) < 0.01);
});

test("Zero timeout falls back to table within ~3s", async () => {
  clearPricingCache();
  const started = Date.now();
  const quote = await getPriceQuote("A100", 8, {
    isZeroReady: () => true,
    timeoutMs: 200,
    runZeroSearch: () =>
      new Promise((resolve) => {
        setTimeout(() => resolve("$2.12/hr"), 5000);
      }),
  });
  const elapsed = Date.now() - started;
  assert.equal(quote.source, "table");
  assert.ok(quote.usdPerMonth >= 12000);
  assert.ok(elapsed < 1500, `expected fast fallback, took ${elapsed}ms`);
});

test("mocked Zero adapter: guardian uses returned prices", async () => {
  clearPricingCache();
  const { app } = createApp({ eventsFile, resetOnStart: true });
  const server = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no port");
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    await fetch(`${baseUrl}/admin/reset`, { method: "POST" });
    const planRes = await fetch(`${baseUrl}/plan_deployment`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "staging-api", gpu: "none", gpuCount: 1 }),
    });
    const plan = (await planRes.json()) as any;
    await fetch(`${baseUrl}/estimate_cost`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ planId: plan.result.planId }),
    });

    // Zero returns a still-cheap CPU rate so approve path works
    const result = await processPendingOnce(baseUrl, 500, false, "", {
      pricing: {
        isZeroReady: () => true,
        runZeroSearch: async () => "CPU instance pricing $0.004/hr",
        timeoutMs: 1000,
      },
      budget: {
        budgetFile,
        // no Nexla → local
      },
    });

    assert.equal(result.reviewed, 1);
    assert.equal(result.approved, 1);
    assert.equal(result.lastPricingSource, "zero");
    assert.equal(result.lastBudgetSource, "local");

    const events = (await (await fetch(`${baseUrl}/events`)).json()) as any;
    const chat = events.events.filter((e: any) => e.kind === "chat");
    const guardianChat = chat.find(
      (e: any) => e.actor === "guardian" && e.detail?.pricingSource
    );
    assert.ok(guardianChat, "expected guardian chat with pricingSource");
    assert.equal(guardianChat.detail.pricingSource, "zero");
    assert.equal(guardianChat.detail.budgetSource, "local");
    assert.match(guardianChat.message, /pricing:Zero/i);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
});

test("mocked Nexla adapter: guardian uses returned budget (reject 8×A100)", async () => {
  clearPricingCache();
  const { app } = createApp({ eventsFile, resetOnStart: true });
  const server = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no port");
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    await fetch(`${baseUrl}/admin/reset`, { method: "POST" });
    const planRes = await fetch(`${baseUrl}/plan_deployment`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "load-test",
        gpu: "A100",
        gpuCount: 8,
      }),
    });
    const plan = (await planRes.json()) as any;
    const estRes = await fetch(`${baseUrl}/estimate_cost`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ planId: plan.result.planId }),
    });
    const est = (await estRes.json()) as any;
    assert.ok(est.result.estimate.usdPerMonth >= 12000);

    const fakeFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  team: "platform-eng",
                  monthly_budget_usd: 500,
                  spent_usd: 50,
                }),
              },
            ],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );

    const result = await processPendingOnce(baseUrl, 500, false, "", {
      pricing: {
        isZeroReady: () => false,
      },
      budget: {
        mcpUrl: "https://nexla.example/mcp",
        serviceKey: "test-key",
        fetchFn: fakeFetch,
        budgetFile,
        timeoutMs: 1000,
      },
    });

    assert.equal(result.reviewed, 1);
    assert.equal(result.rejected, 1);
    assert.equal(result.lastBudgetSource, "nexla");
    assert.equal(result.lastPricingSource, "table");

    const events = (await (await fetch(`${baseUrl}/events`)).json()) as any;
    const rejectChat = events.events.find(
      (e: any) =>
        e.kind === "chat" &&
        e.actor === "guardian" &&
        e.detail?.verdict === "BLOCK"
    );
    assert.ok(rejectChat);
    assert.equal(rejectChat.detail.budgetSource, "nexla");
    assert.match(rejectChat.message, /budget:Nexla/i);
    assert.match(rejectChat.message, /exceeds team budget/i);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
});

test("Nexla timeout falls back to local budget", async () => {
  const b = await getTeamBudget({
    mcpUrl: "https://nexla.example/mcp",
    serviceKey: "key",
    budgetFile,
    timeoutMs: 150,
    fetchFn: () =>
      new Promise(() => {
        /* never resolves */
      }) as Promise<Response>,
  });
  assert.equal(b.source, "local");
  assert.equal(b.monthlyBudgetUsd, 500);
});

test("without Zero/Nexla: 8×A100 still rejected via table+local", () => {
  const proposal = {
    id: "p",
    planId: "pl",
    spec: { name: "load", gpu: "A100", gpuCount: 8 },
    estimate: tableQuote("A100", 8),
    status: "pending",
    createdAt: new Date().toISOString(),
    actor: "dev-agent",
  } as Proposal;
  const d = evaluateProposal(proposal, {
    monthlyBudgetUsd: 500,
    committedSpendUsd: 0,
  });
  assert.equal(d.decision, "rejected");
});

test("cleanup tmp", () => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
