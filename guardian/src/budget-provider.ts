/**
 * Team budget / spend — Nexla MCP when configured, else local data/budget.json.
 * Same TeamBudget interface either way; timeout → local fallback.
 */

import fs from "fs";
import path from "path";
import type { BudgetSource, TeamBudget } from "@secgate/shared";

const DEFAULT_TIMEOUT_MS = Number(process.env.NEXLA_TIMEOUT_MS ?? 3000);

export interface BudgetProviderDeps {
  fetchFn?: typeof fetch;
  budgetFile?: string;
  timeoutMs?: number;
  mcpUrl?: string;
  serviceKey?: string;
  toolName?: string;
}

function defaultBudgetFile(): string {
  if (process.env.SECGATE_BUDGET_FILE) {
    return path.resolve(process.env.SECGATE_BUDGET_FILE);
  }
  const dataDir = process.env.SECGATE_DATA_DIR
    ? path.resolve(process.env.SECGATE_DATA_DIR)
    : path.resolve(__dirname, "../../data");
  return path.join(dataDir, "budget.json");
}

export function loadLocalBudget(filePath?: string): TeamBudget {
  const file = filePath ?? defaultBudgetFile();
  const envCap = Number(process.env.SECGATE_BUDGET_USD ?? 500);
  try {
    if (fs.existsSync(file)) {
      const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
      const monthly = Number(
        raw.monthly_budget_usd ?? raw.monthlyBudgetUsd ?? envCap
      );
      const spent = Number(raw.spent_usd ?? raw.spentUsd ?? 0);
      const team = String(raw.team ?? "platform-eng");
      return {
        team,
        monthlyBudgetUsd: Number.isFinite(monthly) ? monthly : envCap,
        spentUsd: Number.isFinite(spent) ? spent : 0,
        source: "local",
      };
    }
  } catch {
    /* fall through */
  }
  return {
    team: "platform-eng",
    monthlyBudgetUsd: envCap,
    spentUsd: 0,
    source: "local",
  };
}

function nexlaConfigured(deps: BudgetProviderDeps): {
  url: string;
  key: string;
} | null {
  const url =
    deps.mcpUrl ??
    process.env.NEXLA_MCP_URL ??
    process.env.NEXLA_MCP_ENDPOINT ??
    "";
  const key =
    deps.serviceKey ??
    process.env.NEXLA_SERVICE_KEY ??
    process.env.NEXLA_API_KEY ??
    "";
  if (!url.trim() || !key.trim()) return null;
  return { url: url.trim(), key: key.trim() };
}

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${ms}ms`)),
          ms
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Nexla ToolResult dataframe_columns → first-row flat map
 * { columns: [{ name, values: [...] }], rows: N }
 */
function fromDataframeColumns(
  payload: Record<string, unknown>
): Record<string, unknown> | null {
  const columns = payload.columns;
  if (!Array.isArray(columns) || columns.length === 0) return null;
  const row: Record<string, unknown> = {};
  for (const col of columns) {
    if (!col || typeof col !== "object") continue;
    const c = col as { name?: unknown; values?: unknown };
    const name = typeof c.name === "string" ? c.name : "";
    if (!name || !Array.isArray(c.values) || c.values.length === 0) continue;
    row[name] = c.values[0];
  }
  return Object.keys(row).length > 0 ? row : null;
}

function parseBudgetPayload(data: unknown): TeamBudget | null {
  if (data == null) return null;
  let obj: Record<string, unknown>;
  if (typeof data === "string") {
    try {
      obj = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return null;
    }
  } else if (typeof data === "object") {
    obj = data as Record<string, unknown>;
  } else {
    return null;
  }

  // Prefer Nexla structuredContent (toolresult.v1 / dataframe_columns)
  const structured = obj.structuredContent;
  if (structured != null && typeof structured === "object") {
    const sc = structured as Record<string, unknown>;
    if (sc.result != null) {
      const fromResult = parseBudgetPayload(sc.result);
      if (fromResult) return fromResult;
    }
    const dataBlock = sc.data;
    if (dataBlock != null && typeof dataBlock === "object") {
      const d = dataBlock as Record<string, unknown>;
      const payload =
        d.payload != null && typeof d.payload === "object"
          ? (d.payload as Record<string, unknown>)
          : d;
      if (d.format === "dataframe_columns" || Array.isArray(payload.columns)) {
        const row = fromDataframeColumns(payload);
        if (row) {
          const fromRow = parseBudgetPayload(row);
          if (fromRow) return fromRow;
        }
      }
    }
  }

  // MCP tools/call shape: { content: [{ type, text }] }
  if (Array.isArray(obj.content)) {
    const text = obj.content
      .map((c: any) => (c && c.text ? String(c.text) : ""))
      .join("\n")
      .trim();
    // Prefer nested JSON in content text over status-only strings
    if (text.startsWith("{") || text.startsWith("[")) {
      const fromText = parseBudgetPayload(text);
      if (fromText) return fromText;
    }
  }
  if (obj.result != null) {
    const fromResult = parseBudgetPayload(obj.result);
    if (fromResult) return fromResult;
  }
  const monthly = Number(
    obj.monthly_budget_usd ?? obj.monthlyBudgetUsd ?? obj.budget ?? obj.budget_usd
  );
  const spent = Number(obj.spent_usd ?? obj.spentUsd ?? obj.spent ?? 0);
  const team = String(obj.team ?? obj.team_name ?? "platform-eng");
  if (!Number.isFinite(monthly) || monthly <= 0) return null;
  return {
    team,
    monthlyBudgetUsd: monthly,
    spentUsd: Number.isFinite(spent) ? spent : 0,
    source: "nexla" as BudgetSource,
  };
}

/**
 * Call Nexla MCP (JSON-RPC tools/call). Tool name defaults to get_team_budget.
 */
export async function fetchNexlaBudget(
  deps: BudgetProviderDeps = {}
): Promise<TeamBudget> {
  const cfg = nexlaConfigured(deps);
  if (!cfg) throw new Error("Nexla not configured");
  const fetchFn = deps.fetchFn ?? fetch;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const toolName =
    deps.toolName ??
    process.env.NEXLA_BUDGET_TOOL ??
    "get_team_budget";

  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: toolName,
      arguments: { team: process.env.NEXLA_TEAM ?? "platform-eng" },
    },
  };

  const res = await withTimeout(
    fetchFn(cfg.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization: `Bearer ${cfg.key}`,
      },
      body: JSON.stringify(body),
    }),
    timeoutMs,
    "nexla mcp"
  );

  if (!res.ok) {
    throw new Error(`Nexla MCP HTTP ${res.status}`);
  }
  const json = (await res.json()) as { result?: unknown; error?: unknown };
  if (json.error) throw new Error(`Nexla MCP error: ${JSON.stringify(json.error)}`);
  const parsed = parseBudgetPayload(json.result ?? json);
  if (!parsed) throw new Error("Nexla response missing budget fields");
  return { ...parsed, source: "nexla" };
}

/**
 * Prefer Nexla when URL + service key exist; otherwise local JSON / env.
 */
export async function getTeamBudget(
  deps: BudgetProviderDeps = {}
): Promise<TeamBudget> {
  const local = loadLocalBudget(deps.budgetFile);
  if (!nexlaConfigured(deps)) return local;
  try {
    return await fetchNexlaBudget(deps);
  } catch {
    return local;
  }
}

export function describeBudgetSource(b: TeamBudget): string {
  return b.source === "nexla" ? "Nexla" : "local";
}
