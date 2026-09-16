import { useEffect, useRef, useState } from "react";
import { selectAgentTurnPresentation, useSessionStore } from "@/stores/session-store";
import {
  deriveTokensPerSecond,
  recordTokenSample,
  resolveTurnKey,
  type TokenRateState,
} from "./model";

export interface TokenRate {
  tokensPerSecond: number | null;
}

/**
 * Derives the focused agent's output token rate from the cumulative usage the
 * daemon reports while a turn runs. Sampling stops when the turn ends, so the
 * last measured rate stays on screen as the finished speed.
 */
export function useTokenRate(serverId: string, agentId: string): TokenRate {
  const outputTokens = useSessionStore((state) => {
    const agent = state.sessions[serverId]?.agents?.get(agentId);
    return agent?.lastUsage?.outputTokens ?? null;
  });
  const isActive = useSessionStore(
    (state) => selectAgentTurnPresentation(state.sessions[serverId], agentId).isActive,
  );
  const turnId = useSessionStore(
    (state) => selectAgentTurnPresentation(state.sessions[serverId], agentId).turnId,
  );
  const startedAt = useSessionStore(
    (state) => selectAgentTurnPresentation(state.sessions[serverId], agentId).startedAt,
  );

  const stateRef = useRef<TokenRateState | null>(null);
  const [tokensPerSecond, setTokensPerSecond] = useState<number | null>(null);

  useEffect(() => {
    const turnKey = resolveTurnKey({ isActive, turnId, startedAt });
    if (turnKey === null || outputTokens === null) return;

    const at = Date.now();
    stateRef.current = recordTokenSample(stateRef.current, {
      turnKey: `${agentId}:${turnKey}`,
      at,
      outputTokens,
    });
    setTokensPerSecond(deriveTokensPerSecond(stateRef.current, at));
  }, [agentId, isActive, turnId, startedAt, outputTokens]);

  return { tokensPerSecond };
}
