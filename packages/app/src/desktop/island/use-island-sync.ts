import { useEffect, useRef } from "react";
import { useGlobalSearchParams } from "expo-router";
import { getIsElectronRuntimeMac } from "@/constants/layout";
import { isNative } from "@/constants/platform";
import { getDesktopHost, type DesktopIslandAgentPush } from "@/desktop/host";
import { listenToDesktopEvent } from "@/desktop/electron/events";
import { useAggregatedAgents } from "@/hooks/use-aggregated-agents";
import { useSessionStore } from "@/stores/session-store";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import type { AgentPermissionResponse } from "@getpaseo/protocol/agent-types";

const PUSH_DEBOUNCE_MS = 500;
/** Upper bound so a huge directory cannot stall the main-process reducer. */
const MAX_PUSH_AGENTS = 50;

function providerLabel(provider: string): string {
  switch (provider) {
    case "claude-code":
      return "Claude";
    case "codex":
      return "Codex";
    case "copilot":
      return "Copilot";
    case "opencode":
      return "OpenCode";
    case "pi":
      return "Pi";
    default:
      return provider || "Agent";
  }
}

function buildPushList(): DesktopIslandAgentPush[] {
  const { sessions } = useSessionStore.getState();
  const list: DesktopIslandAgentPush[] = [];
  for (const [serverId, session] of Object.entries(sessions)) {
    for (const agent of session.agents?.values() ?? []) {
      if (agent.archivedAt) continue;
      if (list.length >= MAX_PUSH_AGENTS) break;
      list.push({
        agentId: agent.id,
        serverId,
        title: agent.title,
        projectName: agent.projectPlacement?.projectName ?? null,
        agentKind: agent.provider,
        status: agent.status,
        pendingPermissions: agent.pendingPermissions.map((request) => ({
          requestId: request.id,
          toolName: request.name,
          input:
            request.input && typeof request.input === "object" && !Array.isArray(request.input)
              ? (request.input as Record<string, unknown>)
              : {},
          ...(request.title ? { title: request.title } : {}),
          ...(request.description ? { description: request.description } : {}),
        })),
        requiresAttention: agent.requiresAttention ?? false,
        attentionReason: agent.attentionReason ?? null,
        // Timeline preview is a follow-up; title + phase carry the MVP.
        lastAssistantText: null,
        statusText:
          agent.status === "running" ? `${providerLabel(agent.provider)} · Running` : null,
      });
    }
  }
  return list;
}

function pushSignature(list: DesktopIslandAgentPush[]): string {
  return JSON.stringify(
    list.map((agent) => [
      agent.agentId,
      agent.status,
      agent.title,
      agent.requiresAttention,
      agent.attentionReason,
      agent.pendingPermissions.map((p) => p.requestId).join(","),
    ]),
  );
}

interface IslandPermissionActionPayload {
  agentId?: unknown;
  requestId?: unknown;
  behavior?: unknown;
}

interface IslandFocusAgentPayload {
  agentId?: unknown;
  serverId?: unknown;
}

function readResponse(behavior: unknown): { response: AgentPermissionResponse; known: boolean } {
  if (behavior === "allow" || behavior === "allowForSession") {
    // No session-scoped grant convention exists yet; treat as allow-once.
    return { response: { behavior: "allow" }, known: true };
  }
  if (behavior === "deny") {
    return { response: { behavior: "deny" }, known: true };
  }
  return { response: { behavior: "deny" }, known: false };
}

/**
 * Syncs the aggregated agent directory to the main-process Agent Island and
 * routes island interactions (permission allow/deny, focus) back to the
 * DaemonClient owner. Electron-Mac only; no-ops everywhere else.
 */
export function useIslandSync() {
  // Keeps the directory subscription alive; the push list reads the same store.
  useAggregatedAgents({ demand: !isNative && getIsElectronRuntimeMac() });
  const lastSignatureRef = useRef<string | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isNative || !getIsElectronRuntimeMac()) return;
    const push = getDesktopHost()?.island?.push;
    if (typeof push !== "function") return;

    const flush = () => {
      debounceTimerRef.current = null;
      const list = buildPushList();
      const signature = pushSignature(list);
      if (signature === lastSignatureRef.current) return;
      lastSignatureRef.current = signature;
      const island = getDesktopHost()?.island;
      void island?.push?.(list).catch((error) => {
        lastSignatureRef.current = null;
        console.warn("[island] push failed", error);
      });
    };
    const schedule = () => {
      if (debounceTimerRef.current) return;
      debounceTimerRef.current = setTimeout(flush, PUSH_DEBOUNCE_MS);
    };

    // Immediate first push, then follow store updates (debounced).
    flush();
    const unsubscribe = useSessionStore.subscribe(schedule);
    return () => {
      unsubscribe();
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (isNative || !getIsElectronRuntimeMac()) return;
    let disposed = false;
    const unlistens: Array<() => void> = [];

    const connect = async () => {
      try {
        const unlistenPermission = await listenToDesktopEvent<IslandPermissionActionPayload>(
          "island-permission-action",
          (payload) => {
            const agentId = typeof payload?.agentId === "string" ? payload.agentId.trim() : "";
            const requestId =
              typeof payload?.requestId === "string" ? payload.requestId.trim() : "";
            if (!agentId || !requestId) return;
            const { response, known } = readResponse(payload?.behavior);
            if (!known) return;
            const { sessions } = useSessionStore.getState();
            for (const session of Object.values(sessions)) {
              const client = session.client;
              if (!client || !session.agents?.has(agentId)) continue;
              void client.respondToPermission(agentId, requestId, response).catch((error) => {
                console.error("[island] respondToPermission failed", error);
              });
              break;
            }
          },
        );
        const unlistenFocus = await listenToDesktopEvent<IslandFocusAgentPayload>(
          "island-focus-agent",
          (payload) => {
            const agentId = typeof payload?.agentId === "string" ? payload.agentId.trim() : "";
            const serverId = typeof payload?.serverId === "string" ? payload.serverId.trim() : "";
            if (!agentId || !serverId) return;
            navigateToAgent({ serverId, agentId });
          },
        );
        if (disposed) {
          unlistenPermission();
          unlistenFocus();
          return;
        }
        unlistens.push(unlistenPermission, unlistenFocus);
      } catch (error) {
        console.warn("[island] event subscription failed", error);
      }
    };

    void connect();
    return () => {
      disposed = true;
      for (const unlisten of unlistens) unlisten();
      unlistens.length = 0;
    };
  }, []);
}

/**
 * Reports the currently open agent to the island service and acknowledges its
 * card as read. This is how island messages get cleared: open the agent and
 * its card goes away; completed/error cards additionally fade on their own.
 */
export function useIslandVisibleSession() {
  const params = useGlobalSearchParams<{ serverId?: string; agentId?: string }>();
  const serverId = typeof params.serverId === "string" ? params.serverId : null;
  const agentId = typeof params.agentId === "string" ? params.agentId : null;

  useEffect(() => {
    if (isNative || !getIsElectronRuntimeMac()) return;
    const island = getDesktopHost()?.island;
    if (!island) return;
    const visible = agentId && serverId ? agentId : null;
    void island.setVisibleSession?.(visible).catch(() => {
      // Island IPC is best effort; the card still fades via dwell timers.
    });
    if (visible) {
      void island.acknowledgeRead?.(visible).catch(() => {
        // Ignore; unread clears on the next push cycle.
      });
    }
  }, [serverId, agentId]);
}
