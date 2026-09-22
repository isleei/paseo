import { useCallback, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { AgentProvider } from "@getpaseo/protocol/agent-types";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { useFetchQuery } from "@/data/query";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import type { EnvironmentCheckPayload, EnvironmentUpgradeEntry, EnvironmentView } from "./types";

export const ENVIRONMENT_STALE_TIME_MS = 2 * 60 * 1000;

type EnvironmentClient = Pick<DaemonClient, "checkEnvironment" | "upgradeEnvironment">;

export function environmentQueryKey(serverId: string | null | undefined) {
  return ["environmentCheck", serverId ?? ""] as const;
}

async function fetchEnvironmentCheck(client: EnvironmentClient): Promise<EnvironmentCheckPayload> {
  return client.checkEnvironment();
}

export function useEnvironmentCheck(serverId: string | null | undefined): {
  view: EnvironmentView;
  refresh: () => Promise<void>;
  canFetch: boolean;
  upgradeOne: (provider: AgentProvider) => Promise<void>;
  upgradeAll: () => Promise<void>;
  upgradingProvider: AgentProvider | null;
  upgradingAll: boolean;
  lastResults: Partial<Record<AgentProvider, EnvironmentUpgradeEntry>>;
} {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const client = useHostRuntimeClient(serverId ?? "");
  const isConnected = useHostRuntimeIsConnected(serverId ?? "");
  const supportsEnvironment = useSessionStore(
    (state) => state.sessions[serverId ?? ""]?.serverInfo?.features?.environmentCheck === true,
  );
  const queryKey = useMemo(() => environmentQueryKey(serverId), [serverId]);
  const canFetch = Boolean(serverId && client && isConnected && supportsEnvironment);

  const queryFn = useCallback(async () => {
    if (!client) {
      throw new Error(t("settings.environment.hostUnavailable"));
    }
    return fetchEnvironmentCheck(client);
  }, [client, t]);

  const query = useFetchQuery({
    queryKey,
    queryFn,
    enabled: canFetch,
    dataShape: "value",
    staleTimeMs: ENVIRONMENT_STALE_TIME_MS,
    retry: false,
  });

  const [lastResults, setLastResults] = useState<
    Partial<Record<AgentProvider, EnvironmentUpgradeEntry>>
  >({});

  const applyUpgradeResults = useCallback(
    async (results: EnvironmentUpgradeEntry[]) => {
      setLastResults((previous) => {
        const next = { ...previous };
        for (const result of results) {
          next[result.provider] = result;
        }
        return next;
      });
      await queryClient.invalidateQueries({ queryKey });
    },
    [queryClient, queryKey],
  );

  const upgradeOneMutation = useMutation({
    mutationFn: async (provider: AgentProvider) => {
      if (!client) {
        throw new Error(t("settings.environment.hostUnavailable"));
      }
      return client.upgradeEnvironment(provider);
    },
    onSuccess: (payload) => {
      void applyUpgradeResults(payload.results);
    },
  });

  const upgradeAllMutation = useMutation({
    mutationFn: async () => {
      if (!client) {
        throw new Error(t("settings.environment.hostUnavailable"));
      }
      return client.upgradeEnvironment();
    },
    onSuccess: (payload) => {
      void applyUpgradeResults(payload.results);
    },
  });

  const refresh = useCallback(async () => {
    if (!canFetch) return;
    await queryClient.invalidateQueries({ queryKey });
    await queryClient.fetchQuery({
      queryKey,
      queryFn,
      staleTime: ENVIRONMENT_STALE_TIME_MS,
    });
  }, [canFetch, queryClient, queryFn, queryKey]);

  const upgradeOne = useCallback(
    async (provider: AgentProvider) => {
      if (!canFetch) return;
      await upgradeOneMutation.mutateAsync(provider);
    },
    [canFetch, upgradeOneMutation],
  );

  const upgradeAll = useCallback(async () => {
    if (!canFetch) return;
    await upgradeAllMutation.mutateAsync();
  }, [canFetch, upgradeAllMutation]);

  const view = useMemo<EnvironmentView>(() => {
    if (!serverId || !client || !isConnected) {
      return { kind: "error", message: t("settings.environment.hostUnavailable") };
    }
    if (!supportsEnvironment) {
      return { kind: "error", message: t("settings.environment.hostUpgradeRequired") };
    }
    if (query.data) {
      return {
        kind: "ready",
        payload: query.data,
        isFetching: query.isFetching,
      };
    }
    if (query.isError) {
      return {
        kind: "error",
        message: query.error instanceof Error ? query.error.message : String(query.error),
      };
    }
    return { kind: "loading" };
  }, [
    client,
    isConnected,
    query.data,
    query.error,
    query.isError,
    query.isFetching,
    serverId,
    supportsEnvironment,
    t,
  ]);

  return {
    view,
    refresh,
    canFetch,
    upgradeOne,
    upgradeAll,
    upgradingProvider:
      upgradeOneMutation.isPending && upgradeOneMutation.variables
        ? upgradeOneMutation.variables
        : null,
    upgradingAll: upgradeAllMutation.isPending,
    lastResults,
  };
}
