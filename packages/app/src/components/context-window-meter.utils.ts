export function formatTokenCount(value: number): string {
  if (value >= 1_000_000) {
    return `${Math.round(value / 1_000_000)}m`;
  }
  if (value >= 1_000) {
    return `${Math.round(value / 1_000)}k`;
  }
  return Math.round(value).toString();
}

/**
 * Formats token count with K/M units, preserving one decimal place when appropriate
 * to match MiMo Desktop style (e.g. 219.3K, 1.0M, 200K, 307).
 */
export function formatCompactTokens(value: number): string {
  if (value >= 1_000_000) {
    const formatted = (value / 1_000_000).toFixed(1);
    return `${formatted}M`;
  }
  if (value >= 10_000) {
    if (value % 1_000 === 0) {
      return `${Math.round(value / 1_000)}K`;
    }
    return `${(value / 1_000).toFixed(1)}K`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  return Math.round(value).toString();
}

/**
 * Returns formatted used and remaining percentage strings, showing one decimal place
 * if non-integer (e.g. "21.9%" and "78.1%"), or integer if whole (e.g. "0%" and "100%").
 */
export function formatUsagePercentages(pct: number): { used: string; remaining: string } {
  const clamped = Math.max(0, Math.min(100, pct));
  const remaining = Math.max(0, 100 - clamped);
  const isWhole = Number.isInteger(clamped) || Math.round(clamped * 10) % 10 === 0;
  const usedStr = isWhole ? `${Math.round(clamped)}%` : `${clamped.toFixed(1)}%`;
  const isRemainingWhole = Number.isInteger(remaining) || Math.round(remaining * 10) % 10 === 0;
  const remainingStr = isRemainingWhole ? `${Math.round(remaining)}%` : `${remaining.toFixed(1)}%`;
  return { used: usedStr, remaining: remainingStr };
}
