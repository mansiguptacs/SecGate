/**
 * Pomerium policy shim — identity-aware reverse proxy for SecGate tools.
 *
 * Reads Authorization: Bearer <token>, enforces the PPL matrix in policy.yaml,
 * emits ALLOW / BLOCKED audit events into the Control Tower events API, and
 * hot-reloads when guardian rewrites quarantine rules.
 *
 * Swap for real Pomerium (runtime_flags.mcp + IdP) when ready.
 */

import express from "express";
import cors from "cors";
import { PolicyEngine, policySnippet, normalizeToolName } from "./policy";

const GATEWAY_PORT = Number(process.env.SECGATE_GATEWAY_PORT ?? 3200);
/** Bind all interfaces so Laptop A can reach the gateway over LAN. */
const GATEWAY_HOST = process.env.SECGATE_GATEWAY_HOST ?? "0.0.0.0";
const UPSTREAM = process.env.SECGATE_MCP_URL ?? "http://127.0.0.1:3100";

const TOOL_PATHS = new Set([
  "plan_deployment",
  "estimate_cost",
  "apply_deployment",
  "destroy_deployment",
  "list_deployments",
]);

export function createShim(opts?: {
  policyPath?: string;
  upstream?: string;
}): {
  app: express.Express;
  engine: PolicyEngine;
} {
  const engine = new PolicyEngine(opts?.policyPath);
  const upstream = opts?.upstream ?? UPSTREAM;

  const app = express();
  app.use(cors());
  // Capture raw body for proxying; also parse JSON for admin routes
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
      },
    })
  );

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      phase: 2,
      transport: "pomerium-policy-shim",
      label: engine.current.label,
      upstream,
      policyPath: engine.path,
      quarantine: engine.current.quarantine.identities,
    });
  });

  app.get("/policy", (_req, res) => {
    res.json({
      label: engine.current.label,
      snippet: policySnippet(engine.current),
      policy: engine.current,
    });
  });

  app.post("/admin/quarantine", (req, res) => {
    const auth = engine.authorize(
      req.header("authorization") ?? undefined,
      "apply_deployment"
    );
    // Only guardian may quarantine (reuse guardian_only check via apply tool)
    if (!auth.ok || auth.identity?.role !== "guardian") {
      res.status(403).json({
        ok: false,
        error: "Only guardian may quarantine identities",
        code: "POLICY_DENIED",
      });
      return;
    }
    const target = String(req.body?.identity ?? req.body?.email ?? "");
    const reason = String(
      req.body?.reason ?? "Repeated policy violations — identity quarantined"
    );
    if (!target) {
      res.status(400).json({ ok: false, error: "identity required" });
      return;
    }
    try {
      const result = engine.quarantineIdentity(target, reason);
      void emitAudit(upstream, {
        kind: "blocked",
        actor: "guardian",
        message: `QUARANTINE ${result.entry.email}: ${reason}`,
        sponsor: "pomerium",
        title: "Quarantine policy rewrite",
        severity: "block",
        detail: {
          tool: "quarantine",
          entry: result.entry,
          snippetBefore: result.snippetBefore,
          snippetAfter: result.snippetAfter,
          pplDiff: true,
        },
      });
      void emitAudit(upstream, {
        kind: "chat",
        actor: "guardian",
        message: `Quarantined ${result.entry.email}. Even plan_* tools now return 403.`,
        sponsor: "guardian",
        title: "Identity quarantined",
        severity: "block",
        detail: { entry: result.entry },
      });
      res.json({
        ok: true,
        entry: result.entry,
        snippet: policySnippet(result.policy),
        snippetBefore: result.snippetBefore,
        snippetAfter: result.snippetAfter,
      });
    } catch (err) {
      res.status(400).json({ ok: false, error: (err as Error).message });
    }
  });

  app.post("/admin/clear-quarantine", (req, res) => {
    const auth = engine.authorize(
      req.header("authorization") ?? undefined,
      "apply_deployment"
    );
    if (!auth.ok || auth.identity?.role !== "guardian") {
      res.status(403).json({ ok: false, error: "guardian only", code: "POLICY_DENIED" });
      return;
    }
    engine.clearQuarantine();
    res.json({ ok: true, snippet: policySnippet(engine.current) });
  });

  // Tool routes — same paths as Phase 1 HTTP shim, now identity-gated
  app.all(
    [
      "/plan_deployment",
      "/estimate_cost",
      "/apply_deployment",
      "/destroy_deployment",
      "/list_deployments",
      "/tools/:name",
    ],
    async (req, res) => {
      const tool = resolveTool(req);
      if (!tool) {
        res.status(404).json({ ok: false, error: "Unknown tool route" });
        return;
      }

      const decision = engine.authorize(
        req.header("authorization") ?? undefined,
        tool
      );

      if (!decision.ok) {
        const actor = decision.identity?.id ?? "anonymous";
        await emitAudit(upstream, {
          kind: "blocked",
          actor,
          message: `${tool} BLOCKED 403 — ${decision.message}`,
          sponsor: "pomerium",
          title: `${tool} BLOCKED`,
          severity: "block",
          detail: {
            tool,
            code: decision.code,
            status: decision.status,
            email: decision.identity?.email,
          },
        });
        if (decision.code === "POLICY_DENIED" && isMutateTool(tool)) {
          await emitAudit(upstream, {
            kind: "apply_denied",
            actor,
            message: `Pomerium denied ${tool} for non-guardian identity`,
            detail: { tool, code: decision.code },
          });
        }
        if (decision.code === "QUARANTINED") {
          await emitAudit(upstream, {
            kind: "chat",
            actor: "secgate",
            message: `Identity ${decision.identity?.email} is quarantined — ${tool} blocked.`,
            sponsor: "pomerium",
            title: "Quarantined identity 403",
            severity: "block",
            detail: { tool },
          });
        }
        res.status(decision.status).json({
          ok: false,
          error: decision.message,
          code: decision.code,
          tool,
        });
        return;
      }

      const identity = decision.identity;
      try {
        const upstreamPath = toolPath(req, tool);
        const method = req.method === "GET" && tool === "list_deployments" ? "GET" : "POST";
        const headers: Record<string, string> = {
          "content-type": "application/json",
          "x-secgate-actor": identity.id,
          "x-secgate-email": identity.email,
          "x-secgate-via": "pomerium-policy-shim",
        };
        const init: RequestInit = { method, headers };
        if (method === "POST") {
          init.body = JSON.stringify(req.body ?? {});
        }
        const upstreamRes = await fetch(`${upstream}${upstreamPath}`, init);
        const text = await upstreamRes.text();
        let body: unknown = text;
        try {
          body = JSON.parse(text);
        } catch {
          /* keep text */
        }

        // Successful tool calls already emit ALLOW from infra-mcp; shim only audits denials.
        res.status(upstreamRes.status).type("application/json").send(text);
        void body;
      } catch (err) {
        res.status(502).json({
          ok: false,
          error: `Upstream error: ${(err as Error).message}`,
        });
      }
    }
  );

  // Pass-through control-plane routes for convenience (still require any valid token)
  app.use(async (req, res, next) => {
    if (
      req.path.startsWith("/admin/") ||
      req.path === "/health" ||
      req.path === "/policy"
    ) {
      next();
      return;
    }
    // Only proxy known control routes
    const passthrough = [
      "/events",
      "/proposals",
      "/state",
      "/tools",
      "/admin/reset",
    ];
    const match = passthrough.some(
      (p) => req.path === p || req.path.startsWith(p + "/")
    );
    if (!match) {
      next();
      return;
    }
    const identity = engine.identityFromToken(
      req.header("authorization") ?? undefined
    );
    if (!identity) {
      res.status(401).json({ ok: false, error: "Unauthorized", code: "UNAUTHORIZED" });
      return;
    }
    if (engine.isQuarantined(identity) && !req.path.startsWith("/events")) {
      res.status(403).json({
        ok: false,
        error: `Identity ${identity.email} is quarantined`,
        code: "QUARANTINED",
      });
      return;
    }
    try {
      const url = `${upstream}${req.originalUrl}`;
      const headers: Record<string, string> = {
        "x-secgate-actor": identity.id,
        "x-secgate-email": identity.email,
        "x-secgate-via": "pomerium-policy-shim",
      };
      if (req.header("content-type")) {
        headers["content-type"] = String(req.header("content-type"));
      }
      const init: RequestInit = { method: req.method, headers };
      if (req.method !== "GET" && req.method !== "HEAD") {
        init.body = JSON.stringify(req.body ?? {});
      }
      const upstreamRes = await fetch(url, init);
      const text = await upstreamRes.text();
      res.status(upstreamRes.status).type("application/json").send(text);
    } catch (err) {
      res.status(502).json({ ok: false, error: (err as Error).message });
    }
  });

  return { app, engine };
}

function resolveTool(req: express.Request): string | null {
  if (req.params.name) return normalizeToolName(String(req.params.name));
  const base = req.path.replace(/^\//, "").split("/")[0];
  if (TOOL_PATHS.has(base)) return base;
  return null;
}

function toolPath(req: express.Request, tool: string): string {
  if (req.path.startsWith("/tools/")) return `/tools/${tool}`;
  if (tool === "list_deployments" && req.method === "GET") return "/list_deployments";
  return `/${tool}`;
}

function isMutateTool(tool: string): boolean {
  return tool === "apply_deployment" || tool === "destroy_deployment";
}

async function emitAudit(
  upstream: string,
  event: {
    kind: string;
    actor: string;
    message: string;
    detail?: Record<string, unknown>;
    sponsor?: string;
    title?: string;
    severity?: string;
  }
): Promise<void> {
  try {
    await fetch(`${upstream}/events/audit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(event),
    });
  } catch (err) {
    console.warn("[pomerium-shim] audit emit failed:", (err as Error).message);
  }
}

export function startShim(): void {
  const { app, engine } = createShim();
  engine.watch();
  app.listen(GATEWAY_PORT, GATEWAY_HOST, () => {
    console.log(`[pomerium-shim] ${engine.current.label}`);
    console.log(
      `[pomerium-shim] listening on http://${GATEWAY_HOST}:${GATEWAY_PORT} (LAN clients: http://<this-host-ip>:${GATEWAY_PORT})`
    );
    console.log(`[pomerium-shim] upstream MCP  ${UPSTREAM}`);
    console.log(`[pomerium-shim] policy file   ${engine.path}`);
    console.log(
      `[pomerium-shim] tokens: dev=${engine.current.identities.find((i) => i.role === "developer")?.token} guardian=${engine.current.identities.find((i) => i.role === "guardian")?.token}`
    );
  });
}

if (require.main === module) {
  startShim();
}
