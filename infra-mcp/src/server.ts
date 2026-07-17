import path from "path";
import express from "express";
import cors from "cors";
import fs from "fs";
import { EventStore } from "./events";
import { MockBackend } from "./mock-backend";
import { invokeTool, TOOL_NAMES, type ToolName } from "./tools";
import {
  createBackend,
  describeBackend,
  resolveBackendMode,
  type BackendMode,
} from "./backend-factory";
import type { AkashClientConfig } from "./akash-client";
import type { CostEstimate, BudgetSource, PricingSource } from "@secgate/shared";

const PORT = Number(process.env.SECGATE_PORT ?? 3100);
const DATA_DIR = process.env.SECGATE_DATA_DIR
  ? path.resolve(process.env.SECGATE_DATA_DIR)
  : path.resolve(__dirname, "../../data");
const EVENTS_FILE = path.join(DATA_DIR, "events.json");
const BUDGET_FILE = process.env.SECGATE_BUDGET_FILE
  ? path.resolve(process.env.SECGATE_BUDGET_FILE)
  : path.join(DATA_DIR, "budget.json");
const TEAM_BUDGETS_FILE = process.env.SECGATE_TEAM_BUDGETS_FILE
  ? path.resolve(process.env.SECGATE_TEAM_BUDGETS_FILE)
  : path.resolve(__dirname, "../../docs/nexla/team-budgets.json");
const DASHBOARD_DIR = path.resolve(__dirname, "../../dashboard");

export type TeamBudgetRow = {
  team: string;
  monthly_budget_usd: number;
  spent_usd: number;
};

function loadTeamBudgets(): TeamBudgetRow[] {
  try {
    if (fs.existsSync(TEAM_BUDGETS_FILE)) {
      const raw = JSON.parse(fs.readFileSync(TEAM_BUDGETS_FILE, "utf8")) as unknown;
      if (Array.isArray(raw)) {
        return raw
          .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
          .map((r) => ({
            team: String(r.team ?? ""),
            monthly_budget_usd: Number(r.monthly_budget_usd ?? r.monthlyBudgetUsd ?? 0),
            spent_usd: Number(r.spent_usd ?? r.spentUsd ?? 0),
          }))
          .filter((r) => r.team);
      }
    }
  } catch {
    /* fall through */
  }
  const snap = loadBudgetSnapshotFromFile();
  return [
    {
      team: snap.team,
      monthly_budget_usd: snap.budgetUsd,
      spent_usd: snap.spentUsd,
    },
  ];
}

function loadBudgetSnapshotFromFile(): {
  budgetUsd: number;
  spentUsd: number;
  team: string;
  budgetSource: BudgetSource;
} {
  const envCap = Number(process.env.SECGATE_BUDGET_USD ?? 500);
  try {
    if (fs.existsSync(BUDGET_FILE)) {
      const raw = JSON.parse(fs.readFileSync(BUDGET_FILE, "utf8")) as Record<
        string,
        unknown
      >;
      return {
        budgetUsd: Number(raw.monthly_budget_usd ?? raw.monthlyBudgetUsd ?? envCap),
        spentUsd: Number(raw.spent_usd ?? raw.spentUsd ?? 0),
        team: String(raw.team ?? "platform-eng"),
        budgetSource: "local",
      };
    }
  } catch {
    /* ignore */
  }
  return {
    budgetUsd: envCap,
    spentUsd: 0,
    team: "platform-eng",
    budgetSource: "local",
  };
}

function loadBudgetSnapshot(): {
  budgetUsd: number;
  spentUsd: number;
  team: string;
  budgetSource: BudgetSource;
} {
  const defaultTeam = process.env.NEXLA_TEAM ?? "platform-eng";
  const rows = loadTeamBudgets();
  const match = rows.find((r) => r.team === defaultTeam) ?? rows[0];
  if (match) {
    return {
      budgetUsd: match.monthly_budget_usd,
      spentUsd: match.spent_usd,
      team: match.team,
      budgetSource: "local",
    };
  }
  return loadBudgetSnapshotFromFile();
}

const BUDGET_SNAP = loadBudgetSnapshot();
const BUDGET = BUDGET_SNAP.budgetUsd;

export function createApp(opts?: {
  eventsFile?: string;
  resetOnStart?: boolean;
  backendMode?: BackendMode;
  akash?: AkashClientConfig;
}): {
  app: express.Express;
  backend: MockBackend;
  events: EventStore;
  backendMode: BackendMode;
  leaseKind: string;
} {
  const events = new EventStore(opts?.eventsFile ?? EVENTS_FILE);
  const bundle = createBackend(events, {
    mode: opts?.backendMode,
    akash: opts?.akash,
  });
  const { backend, mode: backendMode, leaseKind } = bundle;
  if (opts?.resetOnStart) backend.reset();

  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get("/health", (_req, res) => {
    const snap = loadBudgetSnapshot();
    res.json({
      ok: true,
      phase: Number(process.env.SECGATE_PHASE ?? 1),
      transport: "http-json-shim",
      tools: TOOL_NAMES,
      budgetUsd: snap.budgetUsd,
      budgetSource: snap.budgetSource,
      team: snap.team,
      backend: backendMode,
      leaseProvider: leaseKind,
      backendLabel: describeBackend(bundle),
    });
  });

  /**
   * Public-friendly budget API for Nexla Studio "REST / API source".
   * GET /budget?team=platform-eng → single row (get_team_budget shape)
   * GET /budget → all teams (list_team_budgets shape)
   */
  app.get("/budget", (req, res) => {
    const rows = loadTeamBudgets();
    const team =
      typeof req.query.team === "string" && req.query.team.trim()
        ? req.query.team.trim()
        : undefined;
    res.setHeader("cache-control", "no-store");
    if (!team) {
      res.json({ teams: rows, count: rows.length });
      return;
    }
    const row = rows.find((r) => r.team === team);
    if (!row) {
      res.status(404).json({
        error: `Unknown team: ${team}`,
        known_teams: rows.map((r) => r.team),
      });
      return;
    }
    res.json(row);
  });

  /** Gateway / guardian audit sink (ALLOW / BLOCKED 403 from Pomerium policy shim). */
  app.post("/events/audit", (req, res) => {
    const kind = String(req.body?.kind ?? "blocked");
    const actor = String(req.body?.actor ?? "pomerium");
    const message = String(req.body?.message ?? "");
    const detail =
      req.body?.detail && typeof req.body.detail === "object"
        ? (req.body.detail as Record<string, unknown>)
        : undefined;
    const sponsor = req.body?.sponsor as string | undefined;
    const title =
      typeof req.body?.title === "string" ? (req.body.title as string) : undefined;
    const severity =
      typeof req.body?.severity === "string"
        ? (req.body.severity as string)
        : undefined;
    if (!message) {
      res.status(400).json({ ok: false, error: "message required" });
      return;
    }
    const event = events.append(
      kind as any,
      actor,
      message,
      sponsor
        ? {
            sponsor: sponsor as any,
            title: title || message.slice(0, 80),
            severity: severity as any,
            detail,
          }
        : detail
    );
    res.json({ ok: true, event });
  });

  app.get("/policy", async (_req, res) => {
    // Optional: surface live PPL from shim if SECGATE_GATEWAY_URL is set
    const gateway = process.env.SECGATE_GATEWAY_URL;
    if (gateway) {
      try {
        const r = await fetch(`${gateway}/policy`);
        if (r.ok) {
          res.json(await r.json());
          return;
        }
      } catch {
        /* fall through */
      }
    }
    res.json({
      label: "Phase 1 app-level policy (no Pomerium yet)",
      snippet:
        "allow plan_*, estimate_*, list_*\napply_*/destroy_* → guardian only\nbudget_cap: $500/mo",
    });
  });

  app.get("/tools", (_req, res) => {
    res.json({
      tools: TOOL_NAMES.map((name) => ({
        name,
        description: toolDescription(name),
      })),
      note: "Phase 1 temporary HTTP JSON API. MCP streamable HTTP via Pomerium in Phase 2.",
      backend: backendMode,
      leaseProvider: leaseKind,
    });
  });

  app.post("/tools/:name", async (req, res) => {
    const name = req.params.name as ToolName;
    if (!TOOL_NAMES.includes(name)) {
      res.status(404).json({ error: `Unknown tool: ${name}` });
      return;
    }
    const actor = String(req.header("x-secgate-actor") ?? req.body?.actor ?? "dev-agent");
    try {
      const result = await invokeTool(backend, {
        name,
        arguments: req.body?.arguments ?? req.body ?? {},
        actor,
      });
      res.json({ ok: true, result });
    } catch (err) {
      const e = err as Error & { code?: string };
      const status = e.code === "GUARDIAN_DENIED" ? 403 : 400;
      res.status(status).json({ ok: false, error: e.message, code: e.code });
    }
  });

  // Convenience aliases
  app.post("/plan_deployment", (req, res) => forward(req, res, "plan_deployment"));
  app.post("/estimate_cost", (req, res) => forward(req, res, "estimate_cost"));
  app.post("/apply_deployment", (req, res) => forward(req, res, "apply_deployment"));
  app.post("/destroy_deployment", (req, res) => forward(req, res, "destroy_deployment"));
  app.get("/list_deployments", async (req, res) => {
    const actor = String(req.header("x-secgate-actor") ?? "dev-agent");
    try {
      const result = await invokeTool(backend, {
        name: "list_deployments",
        arguments: {},
        actor,
      });
      res.json({ ok: true, result });
    } catch (err) {
      res.status(400).json({ ok: false, error: (err as Error).message });
    }
  });

  app.get("/events", async (req, res) => {
    const since = typeof req.query.since === "string" ? req.query.since : undefined;
    let policy: unknown = null;
    const gateway = process.env.SECGATE_GATEWAY_URL;
    if (gateway) {
      try {
        const r = await fetch(`${gateway}/policy`);
        if (r.ok) policy = await r.json();
      } catch {
        /* ignore */
      }
    }
    res.json({
      events: events.list(since),
      committedSpendUsd: backend.committedSpendUsd(),
      budgetUsd: loadBudgetSnapshot().budgetUsd,
      budgetSource: loadBudgetSnapshot().budgetSource,
      pricingSourceDefault: "table" as PricingSource,
      deployments: backend.listDeployments().filter((d) => d.status === "running"),
      policy,
      gate: backend.gateMode,
      phase: Number(process.env.SECGATE_PHASE ?? 1),
      backend: backendMode,
      leaseProvider: leaseKind,
    });
  });

  app.get("/proposals", (req, res) => {
    const status =
      typeof req.query.status === "string"
        ? (req.query.status as "pending" | "approved" | "rejected")
        : undefined;
    res.json({ proposals: backend.listProposals(status) });
  });

  app.post("/proposals/:id/decide", (req, res) => {
    const decision = req.body?.decision as "approved" | "rejected";
    const reason = String(req.body?.reason ?? "");
    const actor = String(req.header("x-secgate-actor") ?? "guardian");
    if (decision !== "approved" && decision !== "rejected") {
      res.status(400).json({ error: "decision must be approved|rejected" });
      return;
    }
    try {
      const meta =
        req.body?.estimate || req.body?.pricingSource || req.body?.budgetSource
          ? {
              estimate: req.body?.estimate as CostEstimate | undefined,
              pricingSource: req.body?.pricingSource as PricingSource | undefined,
              budgetSource: req.body?.budgetSource as BudgetSource | undefined,
            }
          : undefined;
      const proposal = backend.decideProposal(
        req.params.id,
        decision,
        reason,
        actor,
        meta
      );
      res.json({ ok: true, proposal });
    } catch (err) {
      res.status(400).json({ ok: false, error: (err as Error).message });
    }
  });

  app.get("/state", (_req, res) => {
    const snap = loadBudgetSnapshot();
    res.json({
      budgetUsd: snap.budgetUsd,
      budgetSource: snap.budgetSource,
      team: snap.team,
      spentUsd: snap.spentUsd,
      committedSpendUsd: backend.committedSpendUsd(),
      proposals: backend.listProposals(),
      deployments: backend.listDeployments(),
      gate: backend.gateMode,
      backend: backendMode,
      leaseProvider: leaseKind,
    });
  });

  app.post("/admin/reset", (_req, res) => {
    backend.reset();
    res.json({ ok: true, gate: backend.gateMode });
  });

  /** Demo: toggle SecGate ON/OFF (cold open). */
  app.post("/admin/gate", (req, res) => {
    const mode = String(req.body?.mode ?? req.body?.gate ?? "on").toLowerCase();
    if (mode !== "on" && mode !== "off") {
      res.status(400).json({ ok: false, error: "mode must be on|off" });
      return;
    }
    backend.setGate(mode);
    res.json({ ok: true, gate: backend.gateMode });
  });

  app.get("/admin/gate", (_req, res) => {
    res.json({ ok: true, gate: backend.gateMode });
  });

  /** Demo scene 0: seed 8×A100 disaster spend. */
  app.post("/admin/demo/disaster", async (_req, res) => {
    try {
      backend.setGate("off");
      const deployment = await backend.seedDisaster("dev-agent");
      res.json({
        ok: true,
        gate: backend.gateMode,
        deployment,
        committedSpendUsd: backend.committedSpendUsd(),
      });
    } catch (err) {
      res.status(400).json({ ok: false, error: (err as Error).message });
    }
  });

  /** Demo scene 3: pre-seed idle untagged orphan. */
  app.post("/admin/demo/orphan", async (req, res) => {
    try {
      const idleMinutes = Number(req.body?.idleMinutes ?? 20);
      const deployment = await backend.seedOrphan({
        idleMinutes,
        name: req.body?.name,
        usdPerMonth: req.body?.usdPerMonth,
      });
      res.json({
        ok: true,
        deployment,
        committedSpendUsd: backend.committedSpendUsd(),
      });
    } catch (err) {
      res.status(400).json({ ok: false, error: (err as Error).message });
    }
  });

  app.use(express.static(DASHBOARD_DIR));

  async function forward(
    req: express.Request,
    res: express.Response,
    name: ToolName
  ): Promise<void> {
    const actor = String(req.header("x-secgate-actor") ?? req.body?.actor ?? "dev-agent");
    try {
      const result = await invokeTool(backend, {
        name,
        arguments: req.body?.arguments ?? req.body ?? {},
        actor,
      });
      res.json({ ok: true, result });
    } catch (err) {
      const e = err as Error & { code?: string };
      const status = e.code === "GUARDIAN_DENIED" ? 403 : 400;
      res.status(status).json({ ok: false, error: e.message, code: e.code });
    }
  }

  return { app, backend, events, backendMode, leaseKind };
}

function toolDescription(name: ToolName): string {
  switch (name) {
    case "plan_deployment":
      return "Propose an infra deployment (name, gpu, gpuCount, image).";
    case "estimate_cost":
      return "Estimate monthly cost for a planId; creates a pending proposal.";
    case "apply_deployment":
      return "Apply an approved proposal (guardian-only in Phase 1 policy).";
    case "destroy_deployment":
      return "Destroy a running deployment by id.";
    case "list_deployments":
      return "List deployments and committed monthly spend.";
  }
}

export function startServer(): void {
  const { app, backendMode, leaseKind } = createApp({
    resetOnStart: process.env.SECGATE_RESET === "1",
  });
  app.listen(PORT, () => {
    console.log(`[infra-mcp] Phase ${process.env.SECGATE_PHASE ?? 1} HTTP shim on http://localhost:${PORT}`);
    console.log(`[infra-mcp] Backend:  ${backendMode} (${leaseKind}) — set BACKEND=akash to enable Akash path`);
    console.log(`[infra-mcp] Dashboard: http://localhost:${PORT}/`);
    console.log(`[infra-mcp] Tools:     http://localhost:${PORT}/tools`);
    console.log(`[infra-mcp] Events:    http://localhost:${PORT}/events`);
    console.log(`[infra-mcp] Budget API: http://localhost:${PORT}/budget?team=platform-eng`);
    console.log(`[infra-mcp] Budget:    $${BUDGET}/mo`);
    if (backendMode === "akash" && leaseKind === "akash-dry-run") {
      console.log(
        `[infra-mcp] Akash dry-run: no AKASH_API_KEY — leases return realistic demo URLs`
      );
    }
  });
}

if (require.main === module) {
  startServer();
}

export { resolveBackendMode };
