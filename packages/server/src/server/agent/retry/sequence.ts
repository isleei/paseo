import type { AgentRetryState } from "@getpaseo/protocol/messages";
import type { AgentStreamEvent } from "../agent-sdk-types.js";

type TurnFailure = Extract<AgentStreamEvent, { type: "turn_failed" }>;

export const RETRY_CONTINUATION_PROMPT =
  "Continue the interrupted task from the current session state. Check what has already completed before taking further action. Do not repeat completed commands or external side effects. If an action's outcome is uncertain, verify it before proceeding.";

export interface RetryClock {
  now(): number;
  after(delayMs: number, callback: () => void): () => void;
}

export const retryClock: RetryClock = {
  now: Date.now,
  after(delayMs, callback) {
    const timer = setTimeout(callback, delayMs);
    return () => clearTimeout(timer);
  },
};

function retryDelay(failure: TurnFailure, attempt: number): number | null {
  const text = `${failure.code ?? ""} ${failure.error}`;
  const permanent =
    /unauthori[sz]ed|forbidden|authentication|invalid.?api.?key|insufficient.?quota|quota.?exceeded|billing|credit|balance|payment|context.?window|context.?length|invalid.?request|invalid.?argument|permission.?denied|\b(?:400|401|402|403|404|422)\b/i;
  if (permanent.test(text)) return null;
  const transient =
    /\b(?:429|500|502|503|504)\b|rate.?limit|too many requests|overloaded|temporarily unavailable|service unavailable|internal.server.error|ECONNRESET|ETIMEDOUT|EAI_AGAIN|network.error|network.connection|fetch failed|stream disconnected|connection reset|connection closed|request timed out/i;
  if (!transient.test(text)) return null;
  const advertised = text.match(/retry[ -]after(?:-ms)?["']?\s*[:=]\s*["']?(\d+(?:\.\d+)?)/i);
  const backoff = Math.min(5_000 * 2 ** (attempt - 1), 60_000);
  if (!advertised) return backoff;
  const unit = /retry-after-ms/i.test(advertised[0]) ? 1 : 1_000;
  const advertisedMs = Number(advertised[1]) * unit;
  // Node turns overflowing timeout delays into 1 ms, which would hammer the provider.
  if (!Number.isFinite(advertisedMs) || advertisedMs > 2_147_483_647) return null;
  return Math.max(backoff, advertisedMs);
}

type Phase =
  | { status: "active" }
  | { status: "canceled" }
  | {
      status: "waiting";
      cancelTimer(): void;
      ready: Promise<boolean>;
      resolve(proceed: boolean): void;
    };

export class RetrySequence {
  private scheduledTurn: { turnId: string | undefined } | null = null;
  private attempt = 0;
  private phase: Phase = { status: "active" };

  private readonly maxAttempts: number;
  private readonly clock: RetryClock;

  constructor(options: { maxAttempts: number; clock: RetryClock }) {
    this.maxAttempts = options.maxAttempts;
    this.clock = options.clock;
  }

  wasScheduledFor(event: TurnFailure): boolean {
    return this.scheduledTurn !== null && this.scheduledTurn.turnId === event.turnId;
  }

  canContinue(): boolean {
    return this.phase.status === "active";
  }

  schedule(failure: TurnFailure): AgentRetryState | null {
    if (this.phase.status !== "active" || this.attempt >= this.maxAttempts) return null;
    const delayMs = retryDelay(failure, this.attempt + 1);
    if (delayMs === null) return null;
    const state: AgentRetryState = {
      attempt: ++this.attempt,
      maxAttempts: this.maxAttempts,
      retryAt: new Date(this.clock.now() + delayMs).toISOString(),
      error: failure.error,
    };
    let resolve!: (proceed: boolean) => void;
    const ready = new Promise<boolean>((done) => {
      resolve = done;
    });
    const cancelTimer = this.clock.after(delayMs, () => resolve(true));
    this.scheduledTurn = { turnId: failure.turnId };
    this.phase = { status: "waiting", cancelTimer, ready, resolve };
    return state;
  }

  async wait(): Promise<boolean> {
    if (this.phase.status !== "waiting") return false;
    const waiting = this.phase;
    const proceed = await waiting.ready;
    waiting.cancelTimer();
    if (this.phase !== waiting) return false;
    this.scheduledTurn = null;
    this.phase = { status: "active" };
    return proceed;
  }

  retryNow(): boolean {
    if (this.phase.status !== "waiting") return false;
    this.phase.resolve(true);
    return true;
  }

  cancel(): void {
    if (this.phase.status === "waiting") {
      this.phase.cancelTimer();
      this.phase.resolve(false);
    }
    this.phase = { status: "canceled" };
  }
}
