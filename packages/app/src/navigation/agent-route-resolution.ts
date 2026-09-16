import type { HostRuntimeConnectionStatus } from "@/runtime/host-runtime";
import { normalizeWorkspaceOpaqueId } from "@/utils/workspace-identity";

export type AgentRouteLookup =
  | { kind: "idle" }
  | { kind: "fetching" }
  | { kind: "found"; workspaceId: string | null | undefined }
  | { kind: "missing" }
  | { kind: "failed"; error: string };

export type AgentRouteResolution =
  | { kind: "invalid" }
  | { kind: "resolved"; workspaceId: string }
  | { kind: "standalone" }
  | {
      kind: "waitingForHost";
      connectionStatus: Exclude<HostRuntimeConnectionStatus, "online">;
    }
  | { kind: "fetchingAgent" }
  | { kind: "notFound" }
  | { kind: "lookupError"; error: string };

export function resolveAgentRoute(input: {
  serverId: string;
  agentId: string;
  cachedAgentExists: boolean;
  cachedWorkspaceId: string | null | undefined;
  connectionStatus: HostRuntimeConnectionStatus;
  lookup: AgentRouteLookup;
}): AgentRouteResolution {
  if (!input.serverId || !input.agentId) {
    return { kind: "invalid" };
  }

  const cachedWorkspaceId = normalizeWorkspaceOpaqueId(input.cachedWorkspaceId);
  if (cachedWorkspaceId) {
    return { kind: "resolved", workspaceId: cachedWorkspaceId };
  }

  if (input.cachedAgentExists) {
    return { kind: "standalone" };
  }

  if (input.connectionStatus !== "online") {
    return { kind: "waitingForHost", connectionStatus: input.connectionStatus };
  }

  if (input.lookup.kind === "found") {
    const fetchedWorkspaceId = normalizeWorkspaceOpaqueId(input.lookup.workspaceId);
    return fetchedWorkspaceId
      ? { kind: "resolved", workspaceId: fetchedWorkspaceId }
      : { kind: "standalone" };
  }

  if (input.lookup.kind === "missing") {
    return { kind: "notFound" };
  }

  if (input.lookup.kind === "failed") {
    return { kind: "lookupError", error: input.lookup.error };
  }

  return { kind: "fetchingAgent" };
}
