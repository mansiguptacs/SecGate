/**
 * Abuse tracking + quarantine via Pomerium policy rewrite.
 */

export interface AbuseTrackerOptions {
  threshold: number;
  /** Tools that count toward quarantine (mutate attempts blocked by policy). */
  mutateTools?: string[];
}

export class AbuseTracker {
  private counts = new Map<string, number>();
  private quarantined = new Set<string>();
  private threshold: number;
  private mutateTools: Set<string>;

  constructor(opts: AbuseTrackerOptions) {
    this.threshold = opts.threshold;
    this.mutateTools = new Set(
      opts.mutateTools ?? ["apply_deployment", "destroy_deployment"]
    );
  }

  /** Record a blocked mutate attempt. Returns true if threshold just reached. */
  recordBlocked(actor: string, tool?: string): boolean {
    if (tool && !this.mutateTools.has(tool)) return false;
    if (this.quarantined.has(actor)) return false;
    const next = (this.counts.get(actor) ?? 0) + 1;
    this.counts.set(actor, next);
    if (next >= this.threshold) {
      this.quarantined.add(actor);
      return true;
    }
    return false;
  }

  count(actor: string): number {
    return this.counts.get(actor) ?? 0;
  }

  markQuarantined(actor: string): void {
    this.quarantined.add(actor);
  }

  isQuarantined(actor: string): boolean {
    return this.quarantined.has(actor);
  }

  reset(): void {
    this.counts.clear();
    this.quarantined.clear();
  }
}
