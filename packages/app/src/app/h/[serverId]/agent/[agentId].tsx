import { useCallback, useEffect, useMemo, useRef } from "react";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { useFetchQuery } from "@/data/query";
import {
  resolveAgentRoute,
  type AgentRouteLookup,
  type AgentRouteResolution,
} from "@/navigation/agent-route-resolution";
import { AgentRouteResolutionView } from "@/navigation/agent-route-resolution-view";
import { useSessionStore } from "@/stores/session-store";
import { getHostRuntimeStore, useHostRuntimeSnapshot, useHosts } from "@/runtime/host-runtime";
import { buildHostRootRoute, buildSettingsHostRoute } from "@/utils/host-routes";
import { toErrorMessage } from "@/utils/error-messages";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { StandaloneAgentScreen } from "@/screens/standalone-agent-screen";
import type { Agent } from "@/stores/session-store";

function selectCachedAgent(
  state: ReturnType<typeof useSessionStore.getState>,
  serverId: string,
  agentId: string,
): Agent | null {
  if (!serverId || !agentId) return null;
  const session = state.sessions[serverId];
  return session?.agents.get(agentId) ?? session?.agentDetails.get(agentId) ?? null;
}

function resolveLookup(input: {
  enabled: boolean;
  isFetching: boolean;
  isError: boolean;
  isSuccess: boolean;
  data: AgentRouteLookup | undefined;
  error: unknown;
}): AgentRouteLookup {
  if (!input.enabled) return { kind: "idle" };
  if (input.isFetching) return { kind: "fetching" };
  if (input.isError) return { kind: "failed", error: toErrorMessage(input.error) };
  return input.isSuccess && input.data ? input.data : { kind: "fetching" };
}

function routeNavigationKey(resolution: ReturnType<typeof resolveAgentRoute>): string | null {
  if (resolution.kind === "invalid") return "invalid";
  if (resolution.kind === "resolved") return `workspace:${resolution.workspaceId}`;
  if (resolution.kind === "notFound") return "not-found";
  return null;
}

function showsResolutionView(
  resolution: AgentRouteResolution,
): resolution is Extract<
  AgentRouteResolution,
  { kind: "waitingForHost" | "fetchingAgent" | "lookupError" }
> {
  return (
    resolution.kind === "waitingForHost" ||
    resolution.kind === "fetchingAgent" ||
    resolution.kind === "lookupError"
  );
}

function shouldPrepareAgentRoute(
  serverId: string,
  agentId: string,
  hasCachedAgent: boolean,
): boolean {
  return Boolean(serverId && agentId && !hasCachedAgent);
}

function shouldLookupAgentRoute(input: {
  serverId: string;
  agentId: string;
  hasClient: boolean;
  connectionStatus: string;
  hasCachedAgent: boolean;
}): boolean {
  return Boolean(
    input.serverId &&
    input.agentId &&
    input.hasClient &&
    input.connectionStatus === "online" &&
    !input.hasCachedAgent,
  );
}

export default function HostAgentReadyRoute() {
  return (
    <HostRouteBootstrapBoundary>
      <HostAgentReadyRouteContent />
    </HostRouteBootstrapBoundary>
  );
}

function HostAgentReadyRouteContent() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    serverId?: string;
    agentId?: string;
  }>();
  const handledNavigationRef = useRef<string | null>(null);
  const serverId = typeof params.serverId === "string" ? params.serverId : "";
  const agentId = typeof params.agentId === "string" ? params.agentId : "";
  const hosts = useHosts();
  const runtimeSnapshot = useHostRuntimeSnapshot(serverId);
  const client = runtimeSnapshot?.client ?? null;
  const connectionStatus = runtimeSnapshot?.connectionStatus ?? "connecting";
  const hostName = hosts.find((host) => host.serverId === serverId)?.label ?? serverId;
  const cachedAgent = useSessionStore((state) => selectCachedAgent(state, serverId, agentId));
  const agentWorkspaceId = cachedAgent?.workspaceId ?? null;
  useEffect(() => {
    if (!shouldPrepareAgentRoute(serverId, agentId, cachedAgent !== null)) return;
    void getHostRuntimeStore()
      .prepareAgentRoute(serverId, agentId)
      .catch(() => undefined);
  }, [agentId, cachedAgent, serverId]);
  const shouldLookupAgent = shouldLookupAgentRoute({
    serverId,
    agentId,
    hasClient: client !== null,
    connectionStatus,
    hasCachedAgent: cachedAgent !== null,
  });
  const lookupQuery = useFetchQuery({
    queryKey: ["agentRouteResolution", serverId, agentId, runtimeSnapshot?.clientGeneration ?? 0],
    queryFn: async () => {
      if (!client) {
        throw new Error("Target host client is unavailable");
      }
      const result = await client.fetchAgent({ agentId });
      return result?.agent
        ? { kind: "found" as const, workspaceId: result.agent.workspaceId }
        : { kind: "missing" as const };
    },
    enabled: shouldLookupAgent,
    retry: false,
    dataShape: "value",
    staleTimeMs: 0,
  });
  const lookup = useMemo<AgentRouteLookup>(() => {
    return resolveLookup({
      enabled: shouldLookupAgent,
      isFetching: lookupQuery.isFetching,
      isError: lookupQuery.isError,
      isSuccess: lookupQuery.isSuccess,
      data: lookupQuery.data,
      error: lookupQuery.error,
    });
  }, [
    lookupQuery.data,
    lookupQuery.error,
    lookupQuery.isError,
    lookupQuery.isFetching,
    lookupQuery.isSuccess,
    shouldLookupAgent,
  ]);
  const resolution = resolveAgentRoute({
    serverId,
    agentId,
    cachedAgentExists: cachedAgent !== null,
    cachedWorkspaceId: agentWorkspaceId,
    connectionStatus,
    lookup,
  });

  useEffect(() => {
    const navigationKey = routeNavigationKey(resolution);
    if (!navigationKey || handledNavigationRef.current === navigationKey) {
      return;
    }
    handledNavigationRef.current = navigationKey;

    if (resolution.kind === "resolved") {
      navigateToAgent({ serverId, agentId, workspaceId: resolution.workspaceId });
      return;
    }
    router.replace(resolution.kind === "invalid" ? ("/" as Href) : buildHostRootRoute(serverId));
  }, [agentId, resolution, router, serverId]);

  const handleRetry = useCallback(() => {
    if (resolution.kind === "lookupError") {
      void lookupQuery.refetch();
      return;
    }
    if (serverId) {
      void getHostRuntimeStore().runProbeCycleNow(serverId);
    }
  }, [lookupQuery, resolution.kind, serverId]);
  const handleManageHost = useCallback(() => {
    if (serverId) {
      router.push(buildSettingsHostRoute(serverId));
    }
  }, [router, serverId]);
  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace(serverId ? buildHostRootRoute(serverId) : ("/" as Href));
  }, [router, serverId]);

  if (showsResolutionView(resolution)) {
    // Agent URLs intentionally omit workspaceId. Keep this route mounted while the target host
    // reconnects, then resolve the workspace from the authoritative agent record.
    return (
      <AgentRouteResolutionView
        resolution={resolution}
        hostName={hostName}
        lastHostError={runtimeSnapshot?.lastError ?? null}
        onRetry={handleRetry}
        onManageHost={handleManageHost}
        onBack={handleBack}
      />
    );
  }

  if (resolution.kind === "standalone") {
    return <StandaloneAgentScreen serverId={serverId} agentId={agentId} />;
  }

  return null;
}
