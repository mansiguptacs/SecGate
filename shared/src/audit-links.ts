import type { AuditLink, EventKind, EventSponsor, SecGateEvent } from "./types";

export interface AuditLinkContext {
  sponsors?: EventSponsor[];
  sponsor?: EventSponsor;
  detail?: Record<string, unknown>;
  /** Dashboard origin for local policy viewer, e.g. http://127.0.0.1:3100 */
  dashboardBase?: string;
  env?: Record<string, string | undefined>;
}

function envOf(ctx: AuditLinkContext): Record<string, string | undefined> {
  return ctx.env ?? (typeof process !== "undefined" ? process.env : {});
}

function dashboardBase(ctx: AuditLinkContext): string {
  const env = envOf(ctx);
  if (ctx.dashboardBase) return ctx.dashboardBase.replace(/\/$/, "");
  const port = env.SECGATE_PORT || "3100";
  return `http://127.0.0.1:${port}`;
}

function nexlaConsoleUrl(env: Record<string, string | undefined>): string {
  if (env.NEXLA_CONSOLE_URL) return env.NEXLA_CONSOLE_URL;
  const mcp = env.NEXLA_MCP_URL || "";
  try {
    if (mcp) {
      const host = new URL(mcp).hostname;
      if (host.includes("nexla.io") || host.includes("nexla.com")) {
        if (host.includes("genai") || host.includes("api-genai")) {
          return "https://dataops.nexla.io";
        }
        return `https://${host}`;
      }
    }
  } catch {
    /* ignore */
  }
  return "https://dataops.nexla.io";
}

function akashConsoleUrl(
  env: Record<string, string | undefined>,
  detail?: Record<string, unknown>
): string {
  if (env.AKASH_CONSOLE_URL) return env.AKASH_CONSOLE_URL;
  const dep = detail?.deployment as Record<string, unknown> | undefined;
  const leaseId = String(
    detail?.akashLeaseId ?? dep?.akashLeaseId ?? detail?.leaseId ?? ""
  );
  const dseq = leaseId.startsWith("akash-dseq-")
    ? leaseId.slice("akash-dseq-".length)
    : "";
  if (dseq && /^\d+$/.test(dseq)) {
    return `https://console.akash.network/deployments/${dseq}`;
  }
  return "https://console.akash.network";
}

function zeroConsoleUrl(env: Record<string, string | undefined>): string {
  return env.ZERO_CONSOLE_URL || "https://www.zero.xyz";
}

function policyViewUrl(ctx: AuditLinkContext): string {
  const env = envOf(ctx);
  if (env.SECGATE_POLICY_VIEW_URL) return env.SECGATE_POLICY_VIEW_URL;
  return `${dashboardBase(ctx)}/admin/policy`;
}

function isPublicHttpUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    if (u.hostname.endsWith(".local")) return false;
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return false;
    return true;
  } catch {
    return false;
  }
}

/** Build sponsor console deep-links for Audit Log rows. */
export function buildAuditLinks(ctx: AuditLinkContext): AuditLink[] {
  const env = envOf(ctx);
  const sponsors = uniqueSponsors([
    ...(ctx.sponsors ?? []),
    ...(ctx.sponsor ? [ctx.sponsor] : []),
  ]);
  const detail = ctx.detail ?? {};
  const links: AuditLink[] = [];
  const seen = new Set<string>();

  const push = (label: string, url: string) => {
    const key = `${label}|${url}`;
    if (!url || seen.has(key)) return;
    seen.add(key);
    links.push({ label, url });
  };

  for (const s of sponsors) {
    switch (s) {
      case "akash": {
        const dep = detail.deployment as Record<string, unknown> | undefined;
        const liveUrl = String(detail.liveUrl ?? dep?.liveUrl ?? "");
        if (liveUrl && isPublicHttpUrl(liveUrl)) {
          push("Live deployment", liveUrl);
        }
        push("Akash console", akashConsoleUrl(env, detail));
        break;
      }
      case "nexla":
        push("Nexla budget tool", nexlaConsoleUrl(env));
        break;
      case "zero":
        push("Zero.xyz", zeroConsoleUrl(env));
        break;
      case "pomerium":
        push("View policy", policyViewUrl(ctx));
        break;
      case "guardian":
        push("Control Tower", `${dashboardBase(ctx)}/`);
        break;
      default:
        break;
    }
  }

  return links;
}

function uniqueSponsors(list: EventSponsor[]): EventSponsor[] {
  const out: EventSponsor[] = [];
  const seen = new Set<string>();
  for (const s of list) {
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

/** Infer dense audit action label from kind / title. */
export function inferAuditAction(
  kind: EventKind | string,
  title?: string,
  message?: string
): string {
  const t = (title || "").toLowerCase();
  const m = (message || "").toLowerCase();
  if (kind === "plan" || t.includes("plan")) return "plan";
  if (kind === "estimate" || t.includes("estimate")) return "estimate";
  if (t.includes("budget")) return "budget fetch";
  if (t.includes("pricing") || t.includes("price")) return "pricing";
  if (kind === "guardian_reject" || t === "reject" || m.includes("rejected"))
    return "reject";
  if (kind === "guardian_approve" || t === "approve") return "approve";
  if (kind === "blocked" || kind === "apply_denied" || t.includes("blocked")) {
    if (t.includes("quarantine") || m.includes("quarantine")) return "quarantine";
    return "apply BLOCKED";
  }
  if (kind === "apply" || t.includes("lease create") || t.includes("apply")) {
    if (t.includes("gate off") || m.includes("gate off")) return "apply ALLOW (gate off)";
    return "apply ALLOW";
  }
  if (kind === "destroy" || t.includes("destroy") || t.includes("orphan"))
    return "destroy";
  if (t.includes("quarantine")) return "quarantine";
  if (kind === "allow") return "ALLOW";
  if (kind === "timeline") return title || "timeline";
  return String(kind);
}

export function inferAuditResult(
  severity?: string,
  kind?: string,
  message?: string
): string {
  if (severity === "block" || kind === "blocked" || kind === "apply_denied")
    return "BLOCKED";
  if (kind === "guardian_reject") return "REJECTED";
  if (kind === "guardian_approve" || severity === "allow" || kind === "allow")
    return "ALLOW";
  if (kind === "destroy") return "DESTROYED";
  if (severity === "warn") return "WARN";
  if (message && /denied|blocked|reject/i.test(message)) return "BLOCKED";
  return "OK";
}

export function inferAuditResource(
  detail?: Record<string, unknown>,
  message?: string
): string | undefined {
  if (!detail && !message) return undefined;
  const dep = detail?.deployment as Record<string, unknown> | undefined;
  const name =
    detail?.name ??
    dep?.name ??
    (detail?.spec as Record<string, unknown> | undefined)?.name;
  const id =
    detail?.deploymentId ??
    dep?.id ??
    detail?.proposalId ??
    detail?.planId ??
    detail?.akashLeaseId ??
    dep?.akashLeaseId;
  if (name && id) return `${String(name)} (${String(id)})`;
  if (name) return String(name);
  if (id) return String(id);
  if (detail?.tool) return String(detail.tool);
  return undefined;
}

/** Fill missing audit fields / links on an event (mutates + returns). */
export function enrichAuditEvent<T extends Partial<SecGateEvent>>(
  event: T,
  ctx?: Omit<AuditLinkContext, "sponsors" | "sponsor" | "detail">
): T {
  const sponsors = uniqueSponsors([
    ...(event.sponsors ?? []),
    ...(event.sponsor ? [event.sponsor] : []),
  ]);
  if (sponsors.length && !event.sponsors?.length) {
    event.sponsors = sponsors;
  }
  if (!event.action) {
    event.action = inferAuditAction(
      event.kind ?? "timeline",
      event.title,
      event.message
    );
  }
  if (!event.result) {
    event.result = inferAuditResult(event.severity, event.kind, event.message);
  }
  if (!event.resource) {
    event.resource = inferAuditResource(event.detail, event.message);
  }
  if (!event.links?.length && sponsors.length) {
    event.links = buildAuditLinks({
      sponsors,
      sponsor: event.sponsor,
      detail: event.detail,
      dashboardBase: ctx?.dashboardBase,
      env: ctx?.env,
    });
  }
  return event;
}
