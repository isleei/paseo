/**
 * Paseo port: minimal event/interaction types mirroring Cindy's maker-core
 * shapes that agent-island/state.ts consumes. Structurally compatible so the
 * state reducer stays verbatim; the Paseo adapter feeds these from daemon
 * agent updates.
 */

export type PaseoIslandEventType =
  | "text"
  | "thinking"
  | "tool_use"
  | "tool_result"
  | "status"
  | "done"
  | "error"
  | "interaction_request"
  | "interaction_dismissed";

export interface PaseoIslandAgentEvent {
  type: PaseoIslandEventType | string;
  data: unknown;
  source?: string;
  turnScope?: "turn" | "background";
}

/** Subset of Cindy's InteractionRequest that the island reducer reads. */
export type PaseoIslandInteractionRequest =
  | {
      kind: "permission";
      requestId: string;
      toolUseId?: string;
      toolName: string;
      input: Record<string, unknown>;
      title?: string;
      displayName?: string;
      description?: string;
      suggestions?: unknown[];
    }
  | {
      kind: "ask_user_question";
      requestId: string;
      toolUseId?: string;
      questions: Array<{ question: string; header?: string }>;
    }
  | {
      kind: "plan_review";
      requestId: string;
      toolUseId?: string;
      plan: string;
    }
  | {
      kind: "plugin_setup";
      requestId: string;
      detail: string;
    };

/** Minimal wording slot the reducer threads through (Cindy: ToolRowWording). */
export interface PaseoIslandToolWording {
  running: string;
  verb?: (key: string) => string;
  intentVerb?: (action: string) => string;
  updateFilesLabel?: (count: number) => string;
}

export const DEFAULT_PASEO_ISLAND_TOOL_WORDING: PaseoIslandToolWording = {
  running: "Running",
  verb: (key) => key,
  intentVerb: (action) => action,
  updateFilesLabel: (count) => `Update ${count} files`,
};

/** Paseo has no reconnect-attempt message convention yet; stub returns null. */
export function parsePaseoReconnectAttemptMessage(
  _message: string,
): { attempt: number; maxAttempts: number } | null {
  return null;
}

/** Paseo has no turn-continuation boundary events; never a boundary. */
export function isPaseoTurnContinuationBoundaryEvent(_event: PaseoIslandAgentEvent): boolean {
  return false;
}

export function stripPaseoTrailingPathSeparators(value: string): string {
  let end = value.length;
  while (end > 0 && (value[end - 1] === "/" || value[end - 1] === "\\")) {
    end -= 1;
  }
  return end === value.length ? value : value.slice(0, end);
}
