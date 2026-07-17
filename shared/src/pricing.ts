/** Mock GPU / instance pricing for Phase 1 (Zero.xyz swap later). */

export type GpuType = "none" | "T4" | "A10" | "A100";

export interface PriceRow {
  gpu: GpuType;
  usdPerHour: number;
  /** Approximate monthly at 730 hrs */
  usdPerMonth: number;
  label: string;
}

/** Realistic-ish cloud GPU rates so 8×A100 ≈ $12.4k/mo for the demo. */
export const GPU_PRICING: Record<GpuType, PriceRow> = {
  none: {
    gpu: "none",
    usdPerHour: 0.004,
    usdPerMonth: 3,
    label: "CPU-only (staging API)",
  },
  T4: {
    gpu: "T4",
    usdPerHour: 0.35,
    usdPerMonth: 255,
    label: "NVIDIA T4",
  },
  A10: {
    gpu: "A10",
    usdPerHour: 1.0,
    usdPerMonth: 730,
    label: "NVIDIA A10",
  },
  A100: {
    gpu: "A100",
    usdPerHour: 2.123,
    usdPerMonth: 1550,
    label: "NVIDIA A100 80GB",
  },
};

export const HOURS_PER_MONTH = 730;

export function estimateMonthlyCost(gpu: GpuType, count: number): number {
  const row = GPU_PRICING[gpu] ?? GPU_PRICING.none;
  const units = Math.max(1, count);
  if (gpu === "none") {
    return row.usdPerMonth * units;
  }
  return Math.round(row.usdPerHour * HOURS_PER_MONTH * units);
}

export function formatUsd(n: number): string {
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}
