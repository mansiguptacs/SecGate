import path from "path";
import express from "express";
import cors from "cors";
import { EventStore } from "./events";
import { MockBackend } from "./mock-backend";
import { invokeTool, TOOL_NAMES, type ToolName } from "./tools";

const PORT = Number(process.env.SECGATE_PORT ?? 3100);
const BUDGET = Number(process.env.SECGATE_BUDGET_USD ?? 500);
const DATA_DIR = process.env.SECGATE_DATA_DIR
  ? path.resolve(process.env.SECGATE_DATA_DIR)
  : path.resolve(__dirname, "../../data");
const EVENTS_FILE = path.join(DATA_DIR, "events.json");
const DASHBOARD_DIR = path.resolve(__dirname, "../../dashboard");

export function createApp(opts?: {
  eventsFile?: string;
  resetOnStart?: boolean;
}): {
  app: express.Express;
  backend: MockBackend;
  events: EventStore;
} {
  const events = new EventStore(opts?.eventsFile ?? EVENTS_FILE);
  const backend = new MockBackend(events);
  if (opts?.resetOnStart) backend.reset();

  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      phase: Number(process.env.SECGATE_PHASE ?? 1),
      transport: "http-json-shim",
      tools: TOOL_NAMES,
      budgetUsd: BUDGET,
    });
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
    if (!message) {
      res.status(400).json({ ok: false, error: "message required" });
      return;
    }
    const event = events.append(kind as any, actor, message, detail);
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
    });
  });

  app.post("/tools/:name", (req, res) => {
    const name = req.params.name as ToolName;
    if (!TOOL_NAMES.includes(name)) {
      res.status(404).json({ error: `Unknown tool: ${name}` });
      return;
    }
    const actor = String(req.header("x-secgate-actor") ?? req.body?.actor ?? "dev-agent");
    try {
      const result = invokeTool(backend, {
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
  app.get("/list_deployments", (req, res) => {
    const actor = String(req.header("x-secgate-actor") ?? "dev-agent");
    try {
      const result = invokeTool(backend, {
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
      budgetUsd: BUDGET,
      deployments: backend.listDeployments().filter((d) => d.status === "running"),
      policy,
      phase: Number(process.env.SECGATE_PHASE ?? 1),
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
      const proposal = backend.decideProposal(req.params.id, decision, reason, actor);
      res.json({ ok: true, proposal });
    } catch (err) {
      res.status(400).json({ ok: false, error: (err as Error).message });
    }
  });

  app.get("/state", (_req, res) => {
    res.json({
      budgetUsd: BUDGET,
      committedSpendUsd: backend.committedSpendUsd(),
      proposals: backend.listProposals(),
      deployments: backend.listDeployments(),
    });
  });

  app.post("/admin/reset", (_req, res) => {
    backend.reset();
    res.json({ ok: true });
  });

  app.use(express.static(DASHBOARD_DIR));

  function forward(
    req: express.Request,
    res: express.Response,
    name: ToolName
  ): void {
    const actor = String(req.header("x-secgate-actor") ?? req.body?.actor ?? "dev-agent");
    try {
      const result = invokeTool(backend, {
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

  return { app, backend, events };
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
  const { app } = createApp({ resetOnStart: process.env.SECGATE_RESET === "1" });
  app.listen(PORT, () => {
    console.log(`[infra-mcp] Phase 1 HTTP shim on http://localhost:${PORT}`);
    console.log(`[infra-mcp] Dashboard: http://localhost:${PORT}/`);
    console.log(`[infra-mcp] Tools:     http://localhost:${PORT}/tools`);
    console.log(`[infra-mcp] Events:    http://localhost:${PORT}/events`);
    console.log(`[infra-mcp] Budget:    $${BUDGET}/mo`);
  });
}

if (require.main === module) {
  startServer();
}
