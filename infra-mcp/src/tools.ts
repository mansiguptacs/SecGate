/**
 * Tool surface mirroring the future MCP tools.
 * Phase 1: HTTP JSON shim (MCP streamable HTTP comes with Pomerium in Phase 2).
 */

import type { DeploymentSpec } from "@secgate/shared";
import { MockBackend } from "./mock-backend";

export const TOOL_NAMES = [
  "plan_deployment",
  "estimate_cost",
  "apply_deployment",
  "destroy_deployment",
  "list_deployments",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export interface ToolCall {
  name: ToolName;
  arguments: Record<string, unknown>;
  actor?: string;
}

export async function invokeTool(
  backend: MockBackend,
  call: ToolCall
): Promise<unknown> {
  const actor = call.actor ?? "dev-agent";
  switch (call.name) {
    case "plan_deployment": {
      const spec = call.arguments as unknown as DeploymentSpec;
      if (!spec?.name) throw new Error("plan_deployment requires name");
      return backend.planDeployment(spec, actor);
    }
    case "estimate_cost": {
      const planId = String(call.arguments.planId ?? "");
      if (!planId) throw new Error("estimate_cost requires planId");
      return backend.estimateCost(planId, actor);
    }
    case "apply_deployment": {
      const proposalId = String(call.arguments.proposalId ?? "");
      if (!proposalId) throw new Error("apply_deployment requires proposalId");
      return backend.applyDeployment(proposalId, actor);
    }
    case "destroy_deployment": {
      const deploymentId = String(call.arguments.deploymentId ?? "");
      if (!deploymentId) throw new Error("destroy_deployment requires deploymentId");
      return backend.destroyDeployment(deploymentId, actor);
    }
    case "list_deployments": {
      return {
        deployments: backend.listDeployments(),
        committedSpendUsd: backend.committedSpendUsd(),
      };
    }
    default:
      throw new Error(`Unknown tool: ${(call as ToolCall).name}`);
  }
}
