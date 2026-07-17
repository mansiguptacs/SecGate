import { v4 as uuid } from "uuid";
import type { DeploymentSpec } from "@secgate/shared";

/** Creates / closes Akash (or mock) leases for apply/destroy. */
export interface LeaseProvider {
  readonly kind: "mock" | "akash-dry-run" | "akash-live";
  createLease(spec: DeploymentSpec): Promise<{ leaseId: string; liveUrl: string }>;
  destroyLease(leaseId: string): Promise<void>;
}

export class MockLeaseProvider implements LeaseProvider {
  readonly kind = "mock" as const;

  async createLease(
    spec: DeploymentSpec
  ): Promise<{ leaseId: string; liveUrl: string }> {
    const leaseId = `akash-mock-${uuid().slice(0, 8)}`;
    const liveUrl = `https://${slugify(spec.name)}.mock.akash.secgate.local`;
    return { leaseId, liveUrl };
  }

  async destroyLease(_leaseId: string): Promise<void> {
    /* in-memory only */
  }
}

export function slugify(name: string): string {
  return name.replace(/[^a-z0-9-]/gi, "-").toLowerCase().replace(/-+/g, "-");
}
