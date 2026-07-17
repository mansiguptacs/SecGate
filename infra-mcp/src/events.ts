import fs from "fs";
import path from "path";
import { v4 as uuid } from "uuid";
import type { SecGateEvent, EventKind } from "@secgate/shared";

export class EventStore {
  private events: SecGateEvent[] = [];
  private filePath: string;

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

  append(
    kind: EventKind,
    actor: string,
    message: string,
    detail?: Record<string, unknown>
  ): SecGateEvent {
    const event: SecGateEvent = {
      id: uuid(),
      ts: new Date().toISOString(),
      kind,
      actor,
      message,
      detail,
    };
    this.events.push(event);
    this.persist();
    return event;
  }

  list(since?: string): SecGateEvent[] {
    if (!since) return [...this.events];
    return this.events.filter((e) => e.ts > since);
  }

  clear(): void {
    this.events = [];
    this.persist();
  }
}
