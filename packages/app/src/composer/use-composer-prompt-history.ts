import { useCallback, useEffect, useMemo, useRef } from "react";
import type { ComposerKeyPressEvent } from "@/composer/input/input";
import { useSessionStore } from "@/stores/session-store";

const MAX_GLOBAL_RECENT_PROMPTS = 50;
const globalRecentPrompts: string[] = [];

/**
 * Records a prompt to global recent history for fallback when a session has no prompts.
 */
export function recordGlobalPrompt(text: string): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  if (
    globalRecentPrompts.length === 0 ||
    globalRecentPrompts[globalRecentPrompts.length - 1] !== trimmed
  ) {
    globalRecentPrompts.push(trimmed);
    if (globalRecentPrompts.length > MAX_GLOBAL_RECENT_PROMPTS) {
      globalRecentPrompts.shift();
    }
  }
}

/**
 * Resets global recent history (primarily for tests).
 */
export function resetGlobalPromptsForTesting(): void {
  globalRecentPrompts.length = 0;
}

export interface UseComposerPromptHistoryOptions {
  serverId: string;
  agentId: string | null;
  replaceUserInput: (text: string, selection?: { start: number; end: number }) => void;
}

export interface ComposerPromptHistoryResult {
  /**
   * Key press interceptor for ArrowUp, ArrowDown, and Escape.
   * Returns true if the key press was handled (preventing default/other actions).
   */
  onKeyPress: (event: ComposerKeyPressEvent) => boolean;
  /**
   * Call when a message is submitted or queued to append it to history
   * and reset history browsing state.
   */
  recordSubmittedPrompt: (text: string) => void;
  /**
   * Resets history navigation state without recording a prompt.
   */
  resetHistoryNavigation: () => void;
}

/**
 * Hook providing terminal/REPL-style ArrowUp and ArrowDown prompt history navigation
 * for the composer input box.
 *
 * - ArrowUp: Cycles backwards from newest to oldest user prompts in the session.
 * - ArrowDown: Cycles forwards from older prompts towards newer ones, eventually restoring the user's unsubmitted draft.
 * - Escape: Restores the unsubmitted draft and exits history navigation.
 * - Multi-line safe: Only triggers ArrowUp history navigation if the cursor is at the very top (0, 0) or input is single-line/empty.
 */
export function useComposerPromptHistory({
  serverId,
  agentId,
  replaceUserInput,
}: UseComposerPromptHistoryOptions): ComposerPromptHistoryResult {
  const streamTail = useSessionStore(
    useCallback(
      (state) => (agentId ? state.sessions[serverId]?.agentStreamTail.get(agentId) : undefined),
      [agentId, serverId],
    ),
  );

  const localPromptsRef = useRef<string[]>([]);
  const historyIndexRef = useRef<number>(-1);
  const savedDraftRef = useRef<string>("");

  const prevAgentKeyRef = useRef<string>(`${serverId}:${agentId ?? ""}`);
  const currentAgentKey = `${serverId}:${agentId ?? ""}`;

  if (prevAgentKeyRef.current !== currentAgentKey) {
    prevAgentKeyRef.current = currentAgentKey;
    localPromptsRef.current = [];
    historyIndexRef.current = -1;
    savedDraftRef.current = "";
  }

  // Derive user message prompts from session stream tail (chronological: oldest -> newest)
  const streamPrompts = useMemo(() => {
    if (!streamTail) return [];
    const prompts: string[] = [];
    for (const item of streamTail) {
      if (item.kind === "user_message" && typeof item.text === "string") {
        const trimmed = item.text.trim();
        if (trimmed.length > 0) {
          if (prompts.length === 0 || prompts[prompts.length - 1] !== trimmed) {
            prompts.push(trimmed);
          }
        }
      }
    }
    return prompts;
  }, [streamTail]);

  // Prune local prompts that have been incorporated into streamPrompts
  useEffect(() => {
    if (localPromptsRef.current.length === 0 || streamPrompts.length === 0) return;
    const lastStreamPrompt = streamPrompts[streamPrompts.length - 1];
    const matchIndex = localPromptsRef.current.lastIndexOf(lastStreamPrompt);
    if (matchIndex !== -1) {
      localPromptsRef.current = localPromptsRef.current.slice(matchIndex + 1);
    }
  }, [streamPrompts]);

  const getEffectivePrompts = useCallback((): string[] => {
    const combined: string[] = [...streamPrompts];
    for (const p of localPromptsRef.current) {
      if (combined.length === 0 || combined[combined.length - 1] !== p) {
        combined.push(p);
      }
    }
    return combined.length > 0 ? combined : globalRecentPrompts;
  }, [streamPrompts]);

  const recordSubmittedPrompt = useCallback((text: string) => {
    const trimmed = text.trim();
    if (trimmed.length > 0) {
      const list = localPromptsRef.current;
      if (list.length === 0 || list[list.length - 1] !== trimmed) {
        list.push(trimmed);
      }
      recordGlobalPrompt(trimmed);
    }
    historyIndexRef.current = -1;
    savedDraftRef.current = "";
  }, []);

  const resetHistoryNavigation = useCallback(() => {
    historyIndexRef.current = -1;
    savedDraftRef.current = "";
  }, []);

  const onKeyPress = useCallback(
    (event: ComposerKeyPressEvent): boolean => {
      const { key, preventDefault, input } = event;

      // Use session prompts if available, fallback to global recent prompts
      const effectivePrompts = getEffectivePrompts();

      if (key === "Escape") {
        if (historyIndexRef.current >= 0) {
          historyIndexRef.current = -1;
          const targetText = savedDraftRef.current;
          preventDefault();
          replaceUserInput(targetText, { start: targetText.length, end: targetText.length });
          return true;
        }
        return false;
      }

      if (key === "ArrowUp") {
        if (effectivePrompts.length === 0) {
          return false;
        }

        // Already browsing history: move to older prompt
        if (historyIndexRef.current >= 0) {
          if (historyIndexRef.current < effectivePrompts.length - 1) {
            historyIndexRef.current += 1;
            const targetText =
              effectivePrompts[effectivePrompts.length - 1 - historyIndexRef.current];
            preventDefault();
            replaceUserInput(targetText, { start: targetText.length, end: targetText.length });
            return true;
          }
          // Already at the oldest prompt: stay there
          preventDefault();
          return true;
        }

        // Not currently in history: check if we should enter history mode
        const isMultiLine = input.text.includes("\n");
        const isCursorAtStart = input.selection.start === 0 && input.selection.end === 0;
        const isEmpty = input.text.trim().length === 0;

        // Enter history if input is empty, single-line, or cursor is at the very beginning of multi-line
        if (isEmpty || !isMultiLine || isCursorAtStart) {
          savedDraftRef.current = input.text;
          historyIndexRef.current = 0;
          const targetText = effectivePrompts[effectivePrompts.length - 1];
          preventDefault();
          replaceUserInput(targetText, { start: targetText.length, end: targetText.length });
          return true;
        }

        return false;
      }

      if (key === "ArrowDown") {
        // Only handle ArrowDown if currently browsing history
        if (historyIndexRef.current < 0) {
          return false;
        }

        if (historyIndexRef.current > 0) {
          // Move towards newer prompt
          historyIndexRef.current -= 1;
          const targetText =
            effectivePrompts[effectivePrompts.length - 1 - historyIndexRef.current];
          preventDefault();
          replaceUserInput(targetText, { start: targetText.length, end: targetText.length });
          return true;
        }

        // historyIndexRef.current === 0: restore the original draft
        historyIndexRef.current = -1;
        const targetText = savedDraftRef.current;
        preventDefault();
        replaceUserInput(targetText, { start: targetText.length, end: targetText.length });
        return true;
      }

      return false;
    },
    [getEffectivePrompts, replaceUserInput],
  );

  return {
    onKeyPress,
    recordSubmittedPrompt,
    resetHistoryNavigation,
  };
}
