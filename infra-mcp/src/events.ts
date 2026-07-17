import fs from "fs";
import path from "path";
import { v4 as uuid } from "uuid";
import type {
  SecGateEvent,
  EventKind,
  TimelineMeta,
  EventSponsor,
  EventSeverity,
} from "@secgate/shared";

export interface AppendOpts {
  detail?: Record<string, unknown>;
  sponsor?: EventSponsor;
  title?: string;
  severity?: EventSeverity;
}

export class EventStore {
  private events: SecGateEvent[] = [];
  private filePath: string;
  /** Coalesce identical timeline titles within this window (ms). */
  private coalesceMs = 900;
  private lastTimelineKey = "";
  private lastTimelineAt = 0;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, "utf8");
        this.events = JSON.parse(raw) as SecGateEvent[];
      }
    } catch {
      this.events = [];
    }
  }

  private persist(): void {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.events, null, 2));
  }

  /**
   * Append an event. 4th arg may be a legacy detail bag OR AppendOpts with
   * optional sponsor/title/severity for Control Tower timeline rows.
   */
  append(
    kind: EventKind,
    actor: string,
    message: string,
    detailOrOpts?: Record<string, unknown> | AppendOpts
  ): SecGateEvent {
    const opts = toAppendOpts(detailOrOpts);
    const event: SecGateEvent = {
      id: uuid(),
      ts: new Date().toISOString(),
      kind,
      actor,
      message,
      detail: opts.detail,
      sponsor: opts.sponsor,
      title: opts.title,
      severity: opts.severity,
    };

    if (
      opts.sponsor &&
      this.shouldCoalesce(opts.sponsor, opts.title ?? message)
    ) {
      // Drop duplicate noisy timeline row; still return a synthetic event for callers
      return event;
    }

    if (opts.sponsor) {
      this.lastTimelineKey = `${opts.sponsor}|${opts.title ?? message}`;
      this.lastTimelineAt = Date.now();
    }

    this.events.push(event);
    this.persist();
    return event;
  }

  /** Curated timeline-only row (kind=timeline). Returns null if coalesced. */
  appendTimeline(
    meta: TimelineMeta & {
      kind?: EventKind;
      actor?: string;
      extra?: Record<string, unknown>;
    }
  ): SecGateEvent | null {
    const title = meta.title;
    if (this.shouldCoalesce(meta.sponsor, title)) {
      return null;
    }
    const event = this.append(
      meta.kind ?? "timeline",
      meta.actor ?? "secgate",
      meta.detail ?? meta.title,
      {
        sponsor: meta.sponsor,
        title,
        severity: meta.severity ?? "info",
        detail: {
          blurb: meta.detail ?? meta.title,
          ...(meta.extra ?? {}),
        },
      }
    );
    // If coalesce dropped it inside append, it won't be in the store — detect by id absence
    if (!this.events.some((e) => e.id === event.id)) return null;
    return event;
  }

  private shouldCoalesce(sponsor: EventSponsor, title: string): boolean {
    const key = `${sponsor}|${title}`;
    const now = Date.now();
    return key === this.lastTimelineKey && now - this.lastTimelineAt < this.coalesceMs;
  }

  list(since?: string): SecGateEvent[] {
    if (!since) return [...this.events];
    return this.events.filter((e) => e.ts > since);
  }

  clear(): void {
    this.events = [];
    this.lastTimelineKey = "";
    this.lastTimelineAt = 0;
    this.persist();
  }
}

function toAppendOpts(
  detailOrOpts?: Record<string, unknown> | AppendOpts
): AppendOpts {
  if (!detailOrOpts) return {};
  const hasTimeline =
    "sponsor" in detailOrOpts ||
    "title" in detailOrOpts ||
    "severity" in detailOrOpts;
  if (!hasTimeline) {
    return { detail: detailOrOpts as Record<string, unknown> };
  }
  const o = detailOrOpts as AppendOpts;
  if (o.detail !== undefined) return o;
  // sponsor/title/severity present but no nested detail — leftover keys are detail
  const { sponsor, title, severity, detail, ...rest } = detailOrOpts as Record<
    string,
    unknown
  > &
    AppendOpts;
  const bag =
    detail && typeof detail === "object" && !Array.isArray(detail)
      ? (detail as Record<string, unknown>)
      : Object.keys(rest).length
        ? rest
        : undefined;
  return { sponsor, title, severity, detail: bag };
}

export type { EventSponsor, EventSeverity, TimelineMeta };
