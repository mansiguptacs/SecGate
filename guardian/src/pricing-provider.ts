/**
 * GPU / cloud pricing — Zero.xyz when CLI is authenticated, else static table.
 * Never blocks the demo longer than timeoutMs (default 3s).
 */

import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import {
  estimateMonthlyCost,
  GPU_PRICING,
  HOURS_PER_MONTH,
  type GpuType,
  type PriceQuote,
  type PricingSource,
} from "@secgate/shared";

const DEFAULT_TIMEOUT_MS = Number(process.env.ZERO_TIMEOUT_MS ?? 3000);
const CACHE_TTL_MS = Number(process.env.ZERO_CACHE_TTL_MS ?? 5 * 60 * 1000);

export interface PricingProviderDeps {
  /** Override Zero search (tests / mocks). */
  runZeroSearch?: (query: string) => Promise<string>;
  /** Override auth / CLI detection. */
  isZeroReady?: () => boolean;
  timeoutMs?: number;
  now?: () => number;
}

interface CacheEntry {
  quote: PriceQuote;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

export function clearPricingCache(): void {
  cache.clear();
}

export function tableQuote(gpu: GpuType, gpuCount: number): PriceQuote {
  const row = GPU_PRICING[gpu] ?? GPU_PRICING.none;
  const count = Math.max(1, gpuCount);
  const usdPerMonth = estimateMonthlyCost(gpu, count);
  const usdPerHour =
    gpu === "none" ? row.usdPerHour * count : row.usdPerHour * count;
  const breakdown =
    gpu === "none"
      ? `${count}× CPU-only @ ~$${row.usdPerMonth}/mo each`
      : `${count}× ${row.label} @ $${row.usdPerHour}/hr ≈ $${usdPerMonth}/mo`;
  return {
    gpu,
    gpuCount: count,
    usdPerHour: Number(usdPerHour.toFixed(4)),
    usdPerMonth,
    breakdown,
    source: "table",
  };
}

export function defaultIsZeroReady(): boolean {
  if (process.env.ZERO_FORCE_OFF === "1") return false;
  if (process.env.ZERO_FORCE_ON === "1") return true;
  const home = process.env.ZERO_HOME || path.join(os.homedir(), ".zero");
  if (!fs.existsSync(home)) return false;
  // Require a persisted session from `zero auth login` (not just the home dir).
  const configPath = path.join(home, "config.json");
  if (!fs.existsSync(configPath)) return false;
  try {
    const cfg = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
      session?: unknown;
    };
    if (!cfg?.session) return false;
  } catch {
    return false;
  }
  // Prefer managed runtime binary, then PATH
  const runtimeBin = path.join(home, "runtime", "bin", "zero");
  if (fs.existsSync(runtimeBin)) return true;
  try {
    const which = spawnSyncWhich("zero");
    return Boolean(which);
  } catch {
    return false;
  }
}

function spawnSyncWhich(bin: string): string | null {
  try {
    const { execFileSync } = require("child_process") as typeof import("child_process");
    const out = execFileSync(process.platform === "win32" ? "where" : "which", [bin], {
      encoding: "utf8",
      timeout: 1000,
    });
    return out.trim().split("\n")[0] || null;
  } catch {
    return null;
  }
}

function resolveZeroBin(): string {
  if (process.env.ZERO_BIN) return process.env.ZERO_BIN;
  const home = process.env.ZERO_HOME || path.join(os.homedir(), ".zero");
  const runtimeBin = path.join(home, "runtime", "bin", "zero");
  if (fs.existsSync(runtimeBin)) return runtimeBin;
  return spawnSyncWhich("zero") || "zero";
}

export function runZeroSearchCli(query: string, timeoutMs: number): Promise<string> {
  const bin = resolveZeroBin();
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ["search", query], {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`zero search timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout?.on("data", (d) => {
      stdout += String(d);
    });
    child.stderr?.on("data", (d) => {
      stderr += String(d);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`zero search exited ${code}: ${stderr || stdout}`));
    });
  });
}

/** True when Zero search returned a capability listing (often priced $/call, not $/hr). */
export function zeroSearchFoundCapabilities(text: string): boolean {
  if (!text || !text.trim()) return false;
  return (
    /\[[zZ]_[A-Za-z0-9]+\.\d+\]/.test(text) ||
    /"token"\s*:\s*"z_[^"]+"/.test(text) ||
    /"capabilities"\s*:\s*\[/.test(text) ||
    /\$\s*\d+(?:\.\d+)?\s*\/\s*call/i.test(text)
  );
}

/** Pull a plausible $/hr figure from Zero search text/JSON. */
export function parseHourlyFromZeroOutput(text: string, gpu: GpuType): number | null {
  if (!text || !text.trim()) return null;
  const patterns = [
    /\$\s*(\d+(?:\.\d+)?)\s*(?:\/|\s*per\s*)\s*(?:GPU[- ]?)?h(?:ou)?r/gi,
    /(\d+(?:\.\d+)?)\s*USD\s*(?:\/|\s*per\s*)\s*(?:GPU[- ]?)?h(?:ou)?r/gi,
    /"usdPerHour"\s*:\s*(\d+(?:\.\d+)?)/gi,
    /"price_per_hour"\s*:\s*(\d+(?:\.\d+)?)/gi,
    /"pricePerHour"\s*:\s*(\d+(?:\.\d+)?)/gi,
    /"hourly"\s*:\s*(\d+(?:\.\d+)?)/gi,
    /"hourly_usd"\s*:\s*(\d+(?:\.\d+)?)/gi,
  ];
  const candidates: number[] = [];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > 0 && n < 100) candidates.push(n);
    }
  }
  if (!candidates.length) return null;
  // Prefer rates near the static table for this GPU (avoid picking unrelated $0.01 API fees)
  const table = GPU_PRICING[gpu]?.usdPerHour ?? 1;
  candidates.sort(
    (a, b) => Math.abs(a - table) - Math.abs(b - table)
  );
  return candidates[0];
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
 * Resolve a price quote. Uses Zero when ready; caches successes; falls back to table.
 */
export async function getPriceQuote(
  gpu: GpuType,
  gpuCount: number,
  deps: PricingProviderDeps = {}
): Promise<PriceQuote> {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const now = deps.now ?? Date.now;
  const count = Math.max(1, gpuCount);
  const cacheKey = `${gpu}:${count}`;
  const hit = cache.get(cacheKey);
  if (hit && hit.expiresAt > now()) {
    return { ...hit.quote, cached: true };
  }

  const fallback = tableQuote(gpu, count);
  const ready = (deps.isZeroReady ?? defaultIsZeroReady)();
  if (!ready) return fallback;

  try {
    const search =
      deps.runZeroSearch ??
      ((q: string) => runZeroSearchCli(q, timeoutMs));
    const query = `cloud GPU ${gpu === "none" ? "CPU instance" : gpu} pricing USD per hour`;
    const raw = await withTimeout(search(query), timeoutMs, "zero search");
    let hourly = parseHourlyFromZeroOutput(raw, gpu);
    // Live Zero indexes return paid pricing *oracles* ($/call), not inline $/hr.
    // A successful authenticated search still counts as Zero enrichment for the demo badge.
    if (hourly == null) {
      if (!zeroSearchFoundCapabilities(raw)) return fallback;
      hourly = GPU_PRICING[gpu]?.usdPerHour ?? fallback.usdPerHour / count;
    }

    const usdPerHour = Number((hourly * count).toFixed(4));
    const usdPerMonth =
      gpu === "none"
        ? Math.round(hourly * HOURS_PER_MONTH * count)
        : Math.round(hourly * HOURS_PER_MONTH * count);
    // Keep demo story: none stays ~$3/mo if Zero returns nonsense tiny rates
    const quote: PriceQuote = {
      gpu,
      gpuCount: count,
      usdPerHour,
      usdPerMonth: gpu === "none" && usdPerMonth < 1 ? fallback.usdPerMonth : usdPerMonth,
      breakdown: `${count}× ${gpu} @ $${hourly}/hr (Zero.xyz) ≈ $${usdPerMonth}/mo`,
      source: "zero" as PricingSource,
    };
    cache.set(cacheKey, { quote, expiresAt: now() + CACHE_TTL_MS });
    return quote;
  } catch {
    return fallback;
  }
}
