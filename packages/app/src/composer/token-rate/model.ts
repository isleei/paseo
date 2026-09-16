import type { AgentUsage } from "@getpaseo/protocol/agent-types";

export interface TokenRateSample {
  at: number;
  outputTokens: number;
}

export interface TokenRateState {
  turnKey: string;
  samples: TokenRateSample[];
}

const SECOND_MS = 1_000;

/**
 * Tokens per second is measured over a trailing window rather than the whole
 * turn: providers report cumulative usage on a poll cadence (every few
 * seconds), so a long turn would otherwise average away bursty generation and
 * report a rate that lags the model's current speed.
 */
export const TOKEN_RATE_WINDOW_MS = 15_000;

export function resolveTurnKey(args: {
  isActive: boolean;
  turnId: string | null;
  startedAt: Date | null;
}): string | null {
  if (!args.isActive) return null;
  return `active:${args.turnId ?? args.startedAt?.getTime() ?? "unknown"}`;
}

export function recordTokenSample(
  state: TokenRateState | null,
  args: { turnKey: string; at: number; outputTokens: number },
): TokenRateState {
  const sample: TokenRateSample = { at: args.at, outputTokens: args.outputTokens };

  if (state === null || state.turnKey !== args.turnKey) {
    return { turnKey: args.turnKey, samples: [sample] };
  }

  const newest = state.samples[state.samples.length - 1];
  if (args.outputTokens === newest.outputTokens) {
    return state;
  }
  // A lower count means the provider reset its session totals (rewind, new
  // session), so the previous baseline is no longer comparable.
  if (args.outputTokens < newest.outputTokens) {
    return { turnKey: state.turnKey, samples: [sample] };
  }

  return { turnKey: state.turnKey, samples: [...trimSamples(state.samples, args.at), sample] };
}

function trimSamples(samples: TokenRateSample[], newestAt: number): TokenRateSample[] {
  const cutoff = newestAt - TOKEN_RATE_WINDOW_MS;
  let start = 0;
  while (start < samples.length && samples[start].at <= cutoff) {
    start += 1;
  }
  return start === 0 ? samples : samples.slice(start);
}

export function deriveTokensPerSecond(state: TokenRateState, now: number): number | null {
  const cutoff = now - TOKEN_RATE_WINDOW_MS;
  let start = 0;
  while (start < state.samples.length && state.samples[start].at <= cutoff) {
    start += 1;
  }

  const visibleSamples = start === 0 ? state.samples : state.samples.slice(start);
  if (visibleSamples.length < 2) return null;
  const first = visibleSamples[0];
  const last = visibleSamples[visibleSamples.length - 1];

  const elapsedMs = last.at - first.at;
  if (elapsedMs <= 0) return null;

  const tokensPerSecond = (last.outputTokens - first.outputTokens) / (elapsedMs / SECOND_MS);
  return tokensPerSecond > 0 ? tokensPerSecond : null;
}

export function formatTokensPerSecond(value: number): string {
  if (value >= 10) return Math.round(value).toString();
  return value.toFixed(1);
}

export interface SessionUsageTotals {
  /** Cumulative tokens billed for the session: uncached input, cached input, and output. */
  totalTokens: number;
  /** Share of input tokens served from the prompt cache. Null when no input tokens are reported. */
  cacheHitRate: number | null;
}

/**
 * Codex/OpenAI and ACP report cache as a subset of `inputTokens` (`total === input + output`).
 * Anthropic, Pi, and OpenCode report cache as a disjoint counter, so `cachedInputTokens` can
 * exceed `inputTokens`. Adding cache in the subset case pins a high-hit turn at ~50%.
 */
export function deriveSessionUsageTotals(usage: AgentUsage): SessionUsageTotals {
  const inputTokens = usage.inputTokens ?? 0;
  const cachedInputTokens = usage.cachedInputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;
  const cacheReportedSeparately = cachedInputTokens > inputTokens;
  let inputTotal = inputTokens;
  if (cacheReportedSeparately) {
    inputTotal += cachedInputTokens;
  }
  return {
    totalTokens: inputTotal + outputTokens,
    cacheHitRate: inputTotal > 0 ? cachedInputTokens / inputTotal : null,
  };
}

export function formatCacheHitRate(value: number): string {
  return `${Math.round(value * 100)}%`;
}
