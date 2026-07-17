import assert from "node:assert/strict";
import { test } from "node:test";
import http from "node:http";
import {
  createServer,
  handleJsonRpc,
  loadBudgetPayload,
} from "../src/shim";

test("handleJsonRpc tools/call returns budget fields", () => {
  const { status, payload } = handleJsonRpc({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "get_team_budget",
      arguments: { team: "platform-eng" },
    },
  });
  assert.equal(status, 200);
  assert.equal(payload.jsonrpc, "2.0");
  const result = payload.result as {
    content: Array<{ type: string; text: string }>;
  };
  const budget = JSON.parse(result.content[0].text) as {
    team: string;
    monthly_budget_usd: number;
    spent_usd: number;
  };
  assert.equal(budget.team, "platform-eng");
  assert.ok(budget.monthly_budget_usd > 0);
  assert.ok(Number.isFinite(budget.spent_usd));
});

test("loadBudgetPayload reads data/budget.json shape", () => {
  const b = loadBudgetPayload("platform-eng");
  assert.equal(b.team, "platform-eng");
  assert.equal(b.monthly_budget_usd, 500);
});

test("HTTP shim auth + tools/call end-to-end", async () => {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  const port = addr.port;
  const key = process.env.NEXLA_SERVICE_KEY ?? "nxl_sk_secgate_demo_shim";

  try {
    const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: {
          name: "get_team_budget",
          arguments: { team: "platform-eng" },
        },
      }),
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-secgate-nexla"), "shim");
    const json = (await res.json()) as {
      result: { content: Array<{ text: string }> };
    };
    const budget = JSON.parse(json.result.content[0].text);
    assert.equal(budget.monthly_budget_usd, 500);

    const denied = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer wrong",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 8,
        method: "tools/call",
        params: { name: "get_team_budget", arguments: {} },
      }),
    });
    assert.equal(denied.status, 401);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
});
