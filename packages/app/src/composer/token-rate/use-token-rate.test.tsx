// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionStore, type Agent } from "@/stores/session-store";
import { TURN_LIVENESS_IDLE, type TurnLiveness } from "@/timeline/turn-liveness";
import { useTokenRate } from "./use-token-rate";

const SERVER_ID = "token-rate";
const AGENT_ID = "agent-1";
const EPOCH = new Date("2026-01-01T00:00:00.000Z").getTime();

function openTurn(turnId: string | null, startedAtMs: number): TurnLiveness {
  return {
    phase: "open",
    turnId,
    startedAt: new Date(startedAtMs),
    cancellationRequestId: null,
  };
}

function makeAgent(turn: TurnLiveness, outputTokens: number | null): Agent {
  const now = new Date(EPOCH);
  return {
    serverId: SERVER_ID,
    id: AGENT_ID,
    provider: "mock",
    status: "running",
    turn,
    createdAt: now,
    updatedAt: now,
    lastUserMessageAt: null,
    lastActivityAt: now,
    capabilities: {
      supportsStreaming: true,
      supportsSessionPersistence: true,
      supportsDynamicModes: true,
      supportsMcpServers: true,
      supportsReasoningStream: true,
      supportsToolInvocations: true,
    },
    currentModeId: null,
    availableModes: [],
    pendingPermissions: [],
    persistence: null,
    title: null,
    cwd: "/repo",
    model: null,
    parentAgentId: null,
    labels: {},
    lastUsage: outputTokens === null ? undefined : { outputTokens, totalCostUsd: 0 },
  };
}

function seedAgents(turn: TurnLiveness, outputTokens: number | null): void {
  useSessionStore
    .getState()
    .setAgents(SERVER_ID, new Map([[AGENT_ID, makeAgent(turn, outputTokens)]]));
}

describe("useTokenRate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(EPOCH);
    useSessionStore.getState().initializeSession(SERVER_ID, null as unknown as DaemonClient);
  });

  afterEach(() => {
    useSessionStore.getState().clearSession(SERVER_ID);
    vi.useRealTimers();
  });

  it("reports no rate before a turn produces output", () => {
    const { result } = renderHook(() => useTokenRate(SERVER_ID, AGENT_ID));

    seedAgents(TURN_LIVENESS_IDLE, null);
    expect(result.current.tokensPerSecond).toBeNull();

    act(() => {
      vi.setSystemTime(EPOCH + 1_000);
      seedAgents(TURN_LIVENESS_IDLE, 0);
    });
    expect(result.current.tokensPerSecond).toBeNull();
  });

  it("needs two samples from one turn before reporting a rate", () => {
    const { result } = renderHook(() => useTokenRate(SERVER_ID, AGENT_ID));

    act(() => {
      seedAgents(openTurn("turn-1", EPOCH), 100);
    });
    expect(result.current.tokensPerSecond).toBeNull();

    act(() => {
      vi.setSystemTime(EPOCH + 2_000);
      seedAgents(openTurn("turn-1", EPOCH), 220);
    });
    expect(result.current.tokensPerSecond).toBe(60);
  });

  it("keeps the last measured rate while the turn is idle", () => {
    const { result } = renderHook(() => useTokenRate(SERVER_ID, AGENT_ID));

    act(() => {
      seedAgents(openTurn("turn-1", EPOCH), 100);
    });
    act(() => {
      vi.setSystemTime(EPOCH + 2_000);
      seedAgents(openTurn("turn-1", EPOCH), 220);
    });
    expect(result.current.tokensPerSecond).toBe(60);

    act(() => {
      vi.setSystemTime(EPOCH + 5_000);
      seedAgents(TURN_LIVENESS_IDLE, 220);
    });
    expect(result.current.tokensPerSecond).toBe(60);
  });

  it("resets between turns", () => {
    const { result } = renderHook(() => useTokenRate(SERVER_ID, AGENT_ID));

    act(() => {
      seedAgents(openTurn("turn-1", EPOCH), 100);
    });
    act(() => {
      vi.setSystemTime(EPOCH + 2_000);
      seedAgents(openTurn("turn-1", EPOCH), 220);
    });
    expect(result.current.tokensPerSecond).toBe(60);

    act(() => {
      vi.setSystemTime(EPOCH + 4_000);
      seedAgents(TURN_LIVENESS_IDLE, 220);
    });
    act(() => {
      vi.setSystemTime(EPOCH + 6_000);
      seedAgents(openTurn("turn-2", EPOCH + 6_000), 10);
    });
    expect(result.current.tokensPerSecond).toBeNull();
  });
});
