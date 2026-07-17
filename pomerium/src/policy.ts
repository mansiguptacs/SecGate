/**
 * Pomerium-shaped PPL loader + hot-reload.
 * Swap this module for real Pomerium when IdP/MCP is ready.
 */

import fs from "fs";
import path from "path";
import yaml from "js-yaml";

export interface PolicyIdentity {
  id: string;
  email: string;
  token: string;
  role: "developer" | "guardian" | string;
}

export interface QuarantineEntry {
  id: string;
  email?: string;
  reason?: string;
  since?: string;
}

export interface DenyRule {
  deny?: {
    and?: Array<{ email?: { is?: string }; id?: { is?: string } }>;
  };
  reason?: string;
}

export interface SecGatePolicy {
  version: string;
  label: string;
  identities: PolicyIdentity[];
  allow_tools: string[];
  guardian_only_tools: string[];
  abuse: { blocked_mutate_threshold: number };
  quarantine: { identities: QuarantineEntry[] };
  deny_rules: DenyRule[];
}

export type AuthDecision =
  | { ok: true; identity: PolicyIdentity }
  | { ok: false; status: 401 | 403; code: string; message: string; identity?: PolicyIdentity };

const TOOL_ALIASES: Record<string, string> = {
  plan: "plan_deployment",
  estimate: "estimate_cost",
  apply: "apply_deployment",
  destroy: "destroy_deployment",
  list: "list_deployments",
};

export function normalizeToolName(name: string): string {
  return TOOL_ALIASES[name] ?? name;
}

export function defaultPolicyPath(): string {
  return process.env.SECGATE_POLICY_FILE
    ? path.resolve(process.env.SECGATE_POLICY_FILE)
    : path.resolve(__dirname, "../policy.yaml");
}

export function loadPolicy(filePath: string): SecGatePolicy {
  const raw = fs.readFileSync(filePath, "utf8");
  const doc = yaml.load(raw) as SecGatePolicy;
  if (!doc?.identities?.length) {
    throw new Error(`Invalid policy at ${filePath}: missing identities`);
  }
  doc.allow_tools = doc.allow_tools ?? [];
  doc.guardian_only_tools = doc.guardian_only_tools ?? [];
  doc.abuse = doc.abuse ?? { blocked_mutate_threshold: 3 };
  doc.quarantine = doc.quarantine ?? { identities: [] };
  doc.deny_rules = doc.deny_rules ?? [];
  doc.label =
    doc.label ??
    "Pomerium policy shim — swap for real Pomerium when IdP ready";
  return doc;
}

export function policySnippet(policy: SecGatePolicy): string {
  const q = policy.quarantine.identities
    .map((e) => `  - ${e.email ?? e.id}${e.reason ? ` # ${e.reason}` : ""}`)
    .join("\n");
  return [
    `# ${policy.label}`,
    `allow: ${policy.allow_tools.join(", ")}`,
    `guardian_only: ${policy.guardian_only_tools.join(", ")}`,
    `quarantine:`,
    q || "  (none)",
  ].join("\n");
}

export class PolicyEngine {
  private policy: SecGatePolicy;
  private filePath: string;
  private watcher: fs.FSWatcher | null = null;
  private listeners: Array<(p: SecGatePolicy) => void> = [];

  constructor(filePath = defaultPolicyPath()) {
    this.filePath = filePath;
    this.policy = loadPolicy(filePath);
  }

  get current(): SecGatePolicy {
    return this.policy;
  }

  get path(): string {
    return this.filePath;
  }

  reload(): SecGatePolicy {
    this.policy = loadPolicy(this.filePath);
    for (const fn of this.listeners) fn(this.policy);
    return this.policy;
  }

  onChange(fn: (p: SecGatePolicy) => void): void {
    this.listeners.push(fn);
  }

  watch(): void {
    if (this.watcher) return;
    try {
      this.watcher = fs.watch(this.filePath, { persistent: true }, () => {
        try {
          this.reload();
          console.log(`[pomerium-shim] policy reloaded from ${this.filePath}`);
        } catch (err) {
          console.error("[pomerium-shim] policy reload failed:", (err as Error).message);
        }
      });
    } catch (err) {
      console.warn("[pomerium-shim] fs.watch unavailable:", (err as Error).message);
    }
  }

  stopWatch(): void {
    this.watcher?.close();
    this.watcher = null;
  }

  identityFromToken(token: string | undefined): PolicyIdentity | undefined {
    if (!token) return undefined;
    const bare = token.replace(/^Bearer\s+/i, "").trim();
    return this.policy.identities.find((i) => i.token === bare);
  }

  isQuarantined(identity: PolicyIdentity): boolean {
    return this.policy.quarantine.identities.some(
      (q) => q.id === identity.id || (q.email && q.email === identity.email)
    );
  }

  /**
   * Enforce per-tool allow/deny matrix for an authenticated identity.
   */
  authorize(token: string | undefined, tool: string): AuthDecision {
    const identity = this.identityFromToken(token);
    if (!identity) {
      return {
        ok: false,
        status: 401,
        code: "UNAUTHORIZED",
        message: "Missing or invalid Authorization Bearer token",
      };
    }

    const toolName = normalizeToolName(tool);

    if (this.isQuarantined(identity)) {
      return {
        ok: false,
        status: 403,
        code: "QUARANTINED",
        message: `Identity ${identity.email} is quarantined — all tools denied`,
        identity,
      };
    }

    if (this.policy.guardian_only_tools.includes(toolName)) {
      if (identity.role !== "guardian") {
        return {
          ok: false,
          status: 403,
          code: "POLICY_DENIED",
          message: `Pomerium policy denied ${toolName} for ${identity.email} (guardian only)`,
          identity,
        };
      }
      return { ok: true, identity };
    }

    if (this.policy.allow_tools.includes(toolName)) {
      return { ok: true, identity };
    }

    return {
      ok: false,
      status: 403,
      code: "POLICY_DENIED",
      message: `Tool ${toolName} is not allowed by policy`,
      identity,
    };
  }

  blockedThreshold(): number {
    return this.policy.abuse?.blocked_mutate_threshold ?? 3;
  }

  /**
   * Append quarantine entry + deny rule and persist YAML (hot-reload picks it up).
   */
  quarantineIdentity(
    targetIdOrEmail: string,
    reason: string
  ): { policy: SecGatePolicy; entry: QuarantineEntry; snippetBefore: string; snippetAfter: string } {
    const snippetBefore = policySnippet(this.policy);
    const ident =
      this.policy.identities.find(
        (i) => i.id === targetIdOrEmail || i.email === targetIdOrEmail
      ) ?? null;
    if (!ident) {
      throw new Error(`Unknown identity: ${targetIdOrEmail}`);
    }
    if (ident.role === "guardian") {
      throw new Error("Refusing to quarantine guardian identity");
    }

    const entry: QuarantineEntry = {
      id: ident.id,
      email: ident.email,
      reason,
      since: new Date().toISOString(),
    };

    const already = this.isQuarantined(ident);
    if (!already) {
      this.policy.quarantine.identities.push(entry);
      this.policy.deny_rules.push({
        deny: { and: [{ email: { is: ident.email } }] },
        reason,
      });
      this.persist();
    }

    const snippetAfter = policySnippet(this.policy);
    return { policy: this.policy, entry, snippetBefore, snippetAfter };
  }

  clearQuarantine(): void {
    this.policy.quarantine.identities = [];
    this.policy.deny_rules = [];
    this.persist();
  }

  private persist(): void {
    const dump = yaml.dump(this.policy, {
      lineWidth: 100,
      noRefs: true,
      quotingType: '"',
    });
    const banner = [
      "# AgentFence Pomerium-shaped PPL (auto-written by guardian quarantine)",
      `# ${this.policy.label}`,
      "# Hot-reloaded by the policy shim — swap for real Pomerium when IdP ready.",
      "",
    ].join("\n");
    fs.writeFileSync(this.filePath, banner + dump, "utf8");
    this.policy = loadPolicy(this.filePath);
    for (const fn of this.listeners) fn(this.policy);
  }
}
