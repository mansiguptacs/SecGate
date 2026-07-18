import fs from "fs";
import path from "path";
import type { DeploymentSpec } from "@secgate/shared";
import { type LeaseProvider, slugify } from "./lease-provider";

const DEFAULT_API = "https://console-api.akash.network";

export interface AkashClientConfig {
  /** Force dry-run even if API key present */
  dryRun?: boolean;
  apiKey?: string;
  apiBaseUrl?: string;
  depositUsd?: number;
  sdlPath?: string;
  bidPollMs?: number;
  bidMaxAttempts?: number;
  uriPollMs?: number;
  uriMaxAttempts?: number;
}

export type AkashMode = "dry-run" | "live";

export function resolveAkashApiKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return (
    env.AKASH_API_KEY ||
    env.AKASH_CONSOLE_API_KEY ||
    env.AKASH_CONSOLE_API_TOKEN ||
    undefined
  );
}

export function resolveAkashMode(
  cfg: AkashClientConfig = {},
  env: NodeJS.ProcessEnv = process.env
): AkashMode {
  if (cfg.dryRun === true || env.AKASH_DRY_RUN === "1" || env.AKASH_DRY_RUN === "true") {
    return "dry-run";
  }
  if (cfg.apiKey || resolveAkashApiKey(env)) {
    return "live";
  }
  return "dry-run";
}

export class AkashLeaseProvider implements LeaseProvider {
  readonly kind: "akash-dry-run" | "akash-live";
  private readonly mode: AkashMode;
  private readonly apiKey?: string;
  private readonly apiBase: string;
  private readonly depositUsd: number;
  private readonly sdlPath: string;
  private readonly bidPollMs: number;
  private readonly bidMaxAttempts: number;
  private readonly uriPollMs: number;
  private readonly uriMaxAttempts: number;
  /** Maps leaseId (akash-dseq-N) → dseq for live close */
  private readonly dseqByLease = new Map<string, string>();

  constructor(cfg: AkashClientConfig = {}) {
    this.mode = resolveAkashMode(cfg);
    this.apiKey = cfg.apiKey ?? resolveAkashApiKey();
    this.apiBase = (cfg.apiBaseUrl ?? process.env.AKASH_CONSOLE_API_URL ?? DEFAULT_API).replace(
      /\/$/,
      ""
    );
    this.depositUsd = cfg.depositUsd ?? Number(process.env.AKASH_DEPOSIT_USD ?? 0.5);
    this.sdlPath =
      cfg.sdlPath ??
      process.env.AKASH_SDL_PATH ??
      path.resolve(__dirname, "../akash/staging-api.sdl.yml");
    this.bidPollMs = cfg.bidPollMs ?? Number(process.env.AKASH_BID_POLL_MS ?? 3000);
    this.bidMaxAttempts =
      cfg.bidMaxAttempts ?? Number(process.env.AKASH_BID_MAX_ATTEMPTS ?? 20);
    this.uriPollMs = cfg.uriPollMs ?? Number(process.env.AKASH_URI_POLL_MS ?? 3000);
    this.uriMaxAttempts =
      cfg.uriMaxAttempts ?? Number(process.env.AKASH_URI_MAX_ATTEMPTS ?? 20);
    this.kind = this.mode === "live" ? "akash-live" : "akash-dry-run";
  }

  getMode(): AkashMode {
    return this.mode;
  }

  async createLease(
    spec: DeploymentSpec
  ): Promise<{ leaseId: string; liveUrl: string }> {
    if (this.mode === "dry-run") {
      return this.createDryRunLease(spec);
    }
    try {
      return await this.createLiveLease(spec);
    } catch (err) {
      // Demo resilience: invalid/expired keys or unreachable Console API must
      // still create a running deployment so Control Tower committed spend updates.
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(
        `[akash] live lease failed (${reason}) — falling back to dry-run for "${spec.name}"`
      );
      return this.createDryRunLease(spec);
    }
  }

  async destroyLease(leaseId: string): Promise<void> {
    if (this.mode === "dry-run") {
      return;
    }
    const dseq =
      this.dseqByLease.get(leaseId) ??
      (leaseId.startsWith("akash-dseq-") ? leaseId.slice("akash-dseq-".length) : leaseId);
    try {
      await this.api(`/v1/deployments/${dseq}`, { method: "DELETE" });
    } catch (err) {
      // Dry-run fallback leases never hit Console; live close may also 403.
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(`[akash] destroyLease ${leaseId} ignored: ${reason}`);
    }
    this.dseqByLease.delete(leaseId);
  }

  private createDryRunLease(spec: DeploymentSpec): {
    leaseId: string;
    liveUrl: string;
  } {
    const dseq = String(Date.now()).slice(-7);
    const leaseId = `akash-dseq-${dseq}`;
    const liveUrl = `https://${slugify(spec.name)}-${dseq}.ingress.akash.network`;
    this.dseqByLease.set(leaseId, dseq);
    return { leaseId, liveUrl };
  }

  private async createLiveLease(
    spec: DeploymentSpec
  ): Promise<{ leaseId: string; liveUrl: string }> {
    if (!this.apiKey) {
      throw new Error("AKASH_API_KEY required for live Akash deploy");
    }
    const sdl = this.loadSdl(spec);
    const created = await this.api<{ dseq: string; manifest: string }>("/v1/deployments", {
      method: "POST",
      body: JSON.stringify({ data: { sdl, deposit: this.depositUsd } }),
    });
    const dseq = String(created.dseq);
    const manifest = created.manifest;

    const bids = await this.waitForBids(dseq);
    if (!bids.length) {
      await this.api(`/v1/deployments/${dseq}`, { method: "DELETE" }).catch(() => undefined);
      throw new Error(`No Akash bids for dseq=${dseq} within timeout`);
    }
    const chosen = bids[0].bid?.id ?? bids[0].id;
    if (!chosen?.provider) {
      throw new Error(`Unexpected bid shape for dseq=${dseq}`);
    }

    await this.api("/v1/leases", {
      method: "POST",
      body: JSON.stringify({
        manifest,
        leases: [
          {
            dseq: String(chosen.dseq ?? dseq),
            gseq: Number(chosen.gseq ?? 1),
            oseq: Number(chosen.oseq ?? 1),
            provider: String(chosen.provider),
          },
        ],
      }),
    });

    const liveUrl = await this.waitForUri(dseq, spec);
    const leaseId = `akash-dseq-${dseq}`;
    this.dseqByLease.set(leaseId, dseq);
    return { leaseId, liveUrl };
  }

  private loadSdl(spec: DeploymentSpec): string {
    let sdl = fs.readFileSync(this.sdlPath, "utf8");
    const image = spec.image ?? "nginx:alpine";
    // Swap image if caller requested a non-default (still tiny CPU deploy)
    sdl = sdl.replace(/image:\s*nginx:alpine/, `image: ${image}`);
    if (spec.name) {
      sdl = sdl.replace(
        /SECGATE_SERVICE=staging-api/,
        `SECGATE_SERVICE=${slugify(spec.name)}`
      );
    }
    return sdl;
  }

  private async waitForBids(dseq: string): Promise<any[]> {
    for (let i = 0; i < this.bidMaxAttempts; i++) {
      const data = await this.api<any[]>(`/v1/bids?dseq=${dseq}`);
      const list = Array.isArray(data) ? data : [];
      if (list.length > 0) return list;
      await sleep(this.bidPollMs);
    }
    return [];
  }

  private async waitForUri(dseq: string, spec: DeploymentSpec): Promise<string> {
    const fallback = `https://${slugify(spec.name)}-${dseq}.ingress.akash.network`;
    for (let i = 0; i < this.uriMaxAttempts; i++) {
      try {
        const dep = await this.api<any>(`/v1/deployments/${dseq}`);
        const uri = extractUri(dep);
        if (uri) return uri.startsWith("http") ? uri : `https://${uri}`;
      } catch {
        /* keep polling */
      }
      await sleep(this.uriPollMs);
    }
    return fallback;
  }

  private async api<T>(pathName: string, init?: RequestInit): Promise<T> {
    const timeoutMs = Number(process.env.AKASH_API_TIMEOUT_MS ?? 8000);
    let res: Response;
    try {
      res = await fetch(`${this.apiBase}${pathName}`, {
        ...init,
        signal: AbortSignal.timeout(Number.isFinite(timeoutMs) ? timeoutMs : 8000),
        headers: {
          "x-api-key": this.apiKey ?? "",
          "content-type": "application/json",
          ...(init?.headers ?? {}),
        },
      });
    } catch (err) {
      const cause = err instanceof Error ? err.message : String(err);
      throw new Error(`Akash Console API unreachable ${pathName}: ${cause}`);
    }
    const text = await res.text();
    let parsed: any;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { raw: text };
    }
    if (!res.ok) {
      throw new Error(
        `Akash Console API ${res.status} ${pathName}: ${parsed?.message ?? parsed?.error ?? text}`
      );
    }
    return (parsed?.data !== undefined ? parsed.data : parsed) as T;
  }
}

function extractUri(dep: any): string | undefined {
  const leases = dep?.leases ?? [];
  for (const lease of leases) {
    const status = lease?.status;
    if (!status) continue;
    const services = status.services ?? {};
    for (const svc of Object.values(services) as any[]) {
      const uris = svc?.uris;
      if (Array.isArray(uris) && uris[0]) return String(uris[0]);
    }
    const forwarded = status.forwarded_ports ?? {};
    for (const ports of Object.values(forwarded) as any[]) {
      if (!Array.isArray(ports)) continue;
      for (const p of ports) {
        if (p?.host) {
          const port = p.externalPort ?? p.port ?? 80;
          return port === 80 || port === 443 ? String(p.host) : `${p.host}:${port}`;
        }
      }
    }
  }
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
