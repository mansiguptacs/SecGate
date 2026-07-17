/**
 * Orphan sweep: destroy idle or untagged deployments via guardian identity.
 */

import type { Deployment } from "@secgate/shared";

export interface OrphanCriteria {
  /** Idle longer than this many minutes (based on lastActivityAt || createdAt). */
  idleMinutes: number;
  /** Treat missing ownerTag as orphan. */
  untaggedIsOrphan?: boolean;
}

export function isOrphan(
  dep: Deployment,
  criteria: OrphanCriteria,
  nowMs = Date.now()
): boolean {
  if (dep.status !== "running") return false;

  const untagged = criteria.untaggedIsOrphan !== false && !dep.ownerTag;
  const activity = Date.parse(dep.lastActivityAt ?? dep.createdAt);
  const idleMs = criteria.idleMinutes * 60_000;
  const idle = Number.isFinite(activity) && nowMs - activity >= idleMs;

  return untagged || idle;
}

export function findOrphans(
  deployments: Deployment[],
  criteria: OrphanCriteria,
  nowMs = Date.now()
): Deployment[] {
  return deployments.filter((d) => isOrphan(d, criteria, nowMs));
}
