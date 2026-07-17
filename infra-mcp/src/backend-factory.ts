import { EventStore } from "./events";
import { MockBackend } from "./mock-backend";
import { MockLeaseProvider, type LeaseProvider } from "./lease-provider";
import { AkashLeaseProvider, resolveAkashMode, type AkashClientConfig } from "./akash-client";

export type BackendMode = "mock" | "akash";

export interface BackendBundle {
  backend: MockBackend;
  mode: BackendMode;
  leaseKind: LeaseProvider["kind"];
  leases: LeaseProvider;
}

export function resolveBackendMode(
  env: NodeJS.ProcessEnv = process.env
): BackendMode {
  const raw = (env.BACKEND ?? env.SECGATE_BACKEND ?? "mock").toLowerCase();
  return raw === "akash" ? "akash" : "mock";
}

export function createLeaseProvider(
  mode: BackendMode,
  akashCfg?: AkashClientConfig
): LeaseProvider {
  if (mode === "mock") {
    return new MockLeaseProvider();
  }
  return new AkashLeaseProvider(akashCfg);
}

export function createBackend(
  events: EventStore,
  opts?: {
    mode?: BackendMode;
    akash?: AkashClientConfig;
  }
): BackendBundle {
  const mode = opts?.mode ?? resolveBackendMode();
  const leases = createLeaseProvider(mode, opts?.akash);
  const backend = new MockBackend(events, leases);
  return {
    backend,
    mode,
    leaseKind: leases.kind,
    leases,
  };
}

export function describeBackend(bundle: BackendBundle): string {
  if (bundle.mode === "mock") return "mock";
  const akashMode =
    bundle.leases instanceof AkashLeaseProvider
      ? bundle.leases.getMode()
      : resolveAkashMode();
  return `akash (${akashMode})`;
}
