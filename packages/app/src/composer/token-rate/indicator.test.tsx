// @vitest-environment jsdom

import React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { AgentUsage } from "@getpaseo/protocol/agent-types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/i18n/i18next";
import { useSessionStore, type Agent } from "@/stores/session-store";
import { TURN_LIVENESS_IDLE, type TurnLiveness } from "@/timeline/turn-liveness";
import { TokenRateIndicator } from "./indicator";

// App sources compile against the classic JSX runtime, which expects React on the global.
beforeEach(() => vi.stubGlobal("React", React));

const SERVER_ID = "token-rate";
const AGENT_ID = "agent-1";
const EPOCH = new Date("2026-01-01T00:00:00.000Z").getTime();

function openTurn(turnId: string, startedAtMs: number): TurnLiveness {
  return {
    phase: "open",
    turnId,
    startedAt: new Date(startedAtMs),
    cancellationRequestId: null,
  };
}

function makeAgent(turn: TurnLiveness, usage: Partial<AgentUsage> | null): Agent {
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
    lastUsage: usage === null ? undefined : { totalCostUsd: 0, ...usage },
  };
}

function seedAgents(turn: TurnLiveness, usage: Partial<AgentUsage> | null): void {
  useSessionStore.getState().setAgents(SERVER_ID, new Map([[AGENT_ID, makeAgent(turn, usage)]]));
}

describe("TokenRateIndicator", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(EPOCH);
    useSessionStore.getState().initializeSession(SERVER_ID, null as unknown as DaemonClient);
  });

  afterEach(() => {
    cleanup();
    useSessionStore.getState().clearSession(SERVER_ID);
    vi.useRealTimers();
  });

  it("renders nothing before the daemon reports any usage", () => {
    render(<TokenRateIndicator serverId={SERVER_ID} agentId={AGENT_ID} />);

    act(() => seedAgents(TURN_LIVENESS_IDLE, null));
    expect(screen.queryByTestId("composer-token-rate")).toBeNull();
  });

  it("shows the session totals once usage arrives, even with no measurable rate", () => {
    render(<TokenRateIndicator serverId={SERVER_ID} agentId={AGENT_ID} />);

    act(() => seedAgents(TURN_LIVENESS_IDLE, { outputTokens: 100 }));

    const total = screen.getByTestId("composer-token-rate-total");
    expect(total.textContent).toContain("100");
    expect(total.textContent).toContain(i18n.t("composer.tokenRate.tokensLabel"));
    // No input tokens were reported, so no cache share can be derived.
    expect(screen.queryByTestId("composer-token-rate-cache")).toBeNull();
    expect(screen.queryByTestId("composer.tokenRate-value")).toBeNull();
  });

  it("shows live context occupancy when billed token totals have not arrived yet", () => {
    render(<TokenRateIndicator serverId={SERVER_ID} agentId={AGENT_ID} />);

    act(() => seedAgents(openTurn("turn-1", EPOCH), { contextWindowUsedTokens: 131_527 }));

    const total = screen.getByTestId("composer-token-rate-total");
    expect(total.textContent).toContain("131.5K");
    expect(total.textContent).toContain(i18n.t("composer.tokenRate.tokensLabel"));
    expect(screen.queryByTestId("composer-token-rate-cache")).toBeNull();
  });

  it("shows the measured rate alongside the session totals", () => {
    render(<TokenRateIndicator serverId={SERVER_ID} agentId={AGENT_ID} />);

    act(() => seedAgents(openTurn("turn-1", EPOCH), { outputTokens: 100 }));
    act(() => {
      vi.setSystemTime(EPOCH + 2_000);
      seedAgents(openTurn("turn-1", EPOCH), {
        inputTokens: 20_000,
        cachedInputTokens: 18_000,
        outputTokens: 220,
      });
    });

    const indicator = screen.getByTestId("composer-token-rate");
    expect(indicator.textContent).toContain("60");
    expect(indicator.textContent).toContain(i18n.t("composer.tokenRate.unit"));
    expect(indicator.textContent).toContain("20.2K");
    expect(indicator.textContent).toContain("90%");
    expect(indicator.textContent).toContain(i18n.t("composer.tokenRate.cacheLabel"));
  });
});
