import { describe, expect, it } from "vitest";
import {
  TOKEN_RATE_WINDOW_MS,
  deriveSessionUsageTotals,
  deriveTokensPerSecond,
  formatCacheHitRate,
  formatTokensPerSecond,
  recordTokenSample,
  type TokenRateState,
} from "./model";

const SECOND = 1_000;

describe("recordTokenSample", () => {
  it("seeds the buffer from the first sample", () => {
    const state = recordTokenSample(null, {
      turnKey: "turn-1",
      at: 0,
      outputTokens: 100,
    });
    expect(state).toEqual({
      turnKey: "turn-1",
      samples: [{ at: 0, outputTokens: 100 }],
    });
  });

  it("appends when the cumulative count grows", () => {
    let state: TokenRateState | null = null;
    state = recordTokenSample(state, { turnKey: "turn-1", at: 0, outputTokens: 100 });
    state = recordTokenSample(state, { turnKey: "turn-1", at: SECOND, outputTokens: 160 });

    expect(state.samples).toEqual([
      { at: 0, outputTokens: 100 },
      { at: SECOND, outputTokens: 160 },
    ]);
  });

  it("drops a sample that does not move the count", () => {
    let state: TokenRateState | null = null;
    state = recordTokenSample(state, { turnKey: "turn-1", at: 0, outputTokens: 100 });
    state = recordTokenSample(state, { turnKey: "turn-1", at: SECOND, outputTokens: 100 });

    expect(state.samples).toEqual([{ at: 0, outputTokens: 100 }]);
  });

  it("resets the baseline when the counter falls", () => {
    let state: TokenRateState | null = null;
    state = recordTokenSample(state, { turnKey: "turn-1", at: 0, outputTokens: 500 });
    state = recordTokenSample(state, { turnKey: "turn-1", at: SECOND, outputTokens: 20 });

    expect(state.samples).toEqual([{ at: SECOND, outputTokens: 20 }]);
  });

  it("clears the buffer when the turn changes", () => {
    let state: TokenRateState | null = null;
    state = recordTokenSample(state, { turnKey: "turn-1", at: 0, outputTokens: 100 });
    state = recordTokenSample(state, { turnKey: "turn-1", at: SECOND, outputTokens: 160 });
    state = recordTokenSample(state, { turnKey: "turn-2", at: 2 * SECOND, outputTokens: 160 });

    expect(state.turnKey).toBe("turn-2");
    expect(state.samples).toEqual([{ at: 2 * SECOND, outputTokens: 160 }]);
  });

  it("drops samples older than the rate window", () => {
    let state: TokenRateState | null = null;
    state = recordTokenSample(state, {
      turnKey: "turn-1",
      at: 0,
      outputTokens: 100,
    });
    state = recordTokenSample(state, {
      turnKey: "turn-1",
      at: TOKEN_RATE_WINDOW_MS + SECOND,
      outputTokens: 400,
    });

    expect(state.samples).toEqual([{ at: TOKEN_RATE_WINDOW_MS + SECOND, outputTokens: 400 }]);
  });
});

describe("deriveTokensPerSecond", () => {
  it("is null until two samples land", () => {
    const state = recordTokenSample(null, {
      turnKey: "turn-1",
      at: 0,
      outputTokens: 100,
    });
    expect(deriveTokensPerSecond(state, SECOND)).toBeNull();
  });

  it("divides the token delta by the elapsed seconds", () => {
    let state: TokenRateState | null = null;
    state = recordTokenSample(state, { turnKey: "turn-1", at: 0, outputTokens: 100 });
    state = recordTokenSample(state, { turnKey: "turn-1", at: 5 * SECOND, outputTokens: 250 });

    expect(deriveTokensPerSecond(state, 5 * SECOND)).toBe(30);
  });

  it("is null when the window has no elapsed time", () => {
    let state: TokenRateState | null = null;
    state = recordTokenSample(state, { turnKey: "turn-1", at: 0, outputTokens: 100 });
    state = recordTokenSample(state, { turnKey: "turn-1", at: 0, outputTokens: 250 });

    expect(deriveTokensPerSecond(state, 0)).toBeNull();
  });

  it("ignores samples outside the window", () => {
    let state: TokenRateState | null = null;
    state = recordTokenSample(state, { turnKey: "turn-1", at: 0, outputTokens: 1_000 });
    state = recordTokenSample(state, {
      turnKey: "turn-1",
      at: TOKEN_RATE_WINDOW_MS - SECOND,
      outputTokens: 1_200,
    });
    state = recordTokenSample(state, {
      turnKey: "turn-1",
      at: TOKEN_RATE_WINDOW_MS,
      outputTokens: 1_260,
    });

    expect(deriveTokensPerSecond(state, TOKEN_RATE_WINDOW_MS)).toBe(60);
  });
});

describe("formatTokensPerSecond", () => {
  it("rounds large rates to an integer", () => {
    expect(formatTokensPerSecond(52.6)).toBe("53");
  });

  it("keeps one decimal for slow rates", () => {
    expect(formatTokensPerSecond(8.34)).toBe("8.3");
  });
});

describe("deriveSessionUsageTotals", () => {
  it("treats cache as a subset when it fits inside input (Codex/OpenAI)", () => {
    expect(
      deriveSessionUsageTotals({
        inputTokens: 102_052,
        cachedInputTokens: 101_632,
        outputTokens: 422,
      }),
    ).toEqual({ totalTokens: 102_474, cacheHitRate: 101_632 / 102_052 });
  });

  it("adds cache when it is reported separately from input (Anthropic/Pi/OpenCode)", () => {
    expect(
      deriveSessionUsageTotals({
        inputTokens: 345,
        cachedInputTokens: 101_617,
        outputTokens: 580,
      }),
    ).toEqual({ totalTokens: 102_542, cacheHitRate: 101_617 / 101_962 });
  });

  it("treats missing counts as zero", () => {
    expect(deriveSessionUsageTotals({ outputTokens: 500 })).toEqual({
      totalTokens: 500,
      cacheHitRate: null,
    });
  });

  it("reports no cache share when nothing was read from cache", () => {
    expect(deriveSessionUsageTotals({ inputTokens: 10_000, cachedInputTokens: 0 })).toEqual({
      totalTokens: 10_000,
      cacheHitRate: 0,
    });
  });
});

describe("formatCacheHitRate", () => {
  it("rounds to a whole percentage", () => {
    expect(formatCacheHitRate(0.4)).toBe("40%");
    expect(formatCacheHitRate(0.6666)).toBe("67%");
  });
});
