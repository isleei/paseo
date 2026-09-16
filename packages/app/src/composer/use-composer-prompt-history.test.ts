// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionStore } from "@/stores/session-store";
import { createUserMessage } from "@/types/stream";
import type { ComposerKeyPressEvent } from "./input/input";
import {
  resetGlobalPromptsForTesting,
  useComposerPromptHistory,
} from "./use-composer-prompt-history";

const SERVER_ID = "test-server";
const AGENT_ID = "test-agent";

function createKeyPressEvent(input: {
  key: string;
  text?: string;
  selection?: { start: number; end: number };
}): { event: ComposerKeyPressEvent; preventDefault: ReturnType<typeof vi.fn> } {
  const preventDefault = vi.fn();
  const text = input.text ?? "";
  const selection = input.selection ?? { start: text.length, end: text.length };
  return {
    event: {
      key: input.key,
      preventDefault,
      input: {
        text,
        selection,
      },
    },
    preventDefault,
  };
}

describe("useComposerPromptHistory", () => {
  beforeEach(() => {
    resetGlobalPromptsForTesting();
    useSessionStore.getState().initializeSession(SERVER_ID, null, 0);
    useSessionStore
      .getState()
      .setAgentStreamTail(
        SERVER_ID,
        new Map([
          [
            AGENT_ID,
            [
              createUserMessage({ id: "msg-1", text: "first prompt", timestamp: new Date() }),
              createUserMessage({ id: "msg-2", text: "second prompt", timestamp: new Date() }),
              createUserMessage({ id: "msg-3", text: "third prompt", timestamp: new Date() }),
            ],
          ],
        ]),
      );
  });

  afterEach(() => {
    useSessionStore.getState().clearSession(SERVER_ID);
    resetGlobalPromptsForTesting();
  });

  it("navigates backwards through session history on ArrowUp", () => {
    const replaceUserInput = vi.fn();
    const { result } = renderHook(() =>
      useComposerPromptHistory({
        serverId: SERVER_ID,
        agentId: AGENT_ID,
        replaceUserInput,
      }),
    );

    // 1st ArrowUp on empty input -> should load newest ("third prompt")
    const { event: ev1, preventDefault: pd1 } = createKeyPressEvent({
      key: "ArrowUp",
      text: "",
    });
    const handled1 = result.current.onKeyPress(ev1);
    expect(handled1).toBe(true);
    expect(pd1).toHaveBeenCalled();
    expect(replaceUserInput).toHaveBeenLastCalledWith("third prompt", {
      start: "third prompt".length,
      end: "third prompt".length,
    });

    // 2nd ArrowUp -> should load "second prompt"
    const { event: ev2, preventDefault: pd2 } = createKeyPressEvent({
      key: "ArrowUp",
      text: "third prompt",
    });
    const handled2 = result.current.onKeyPress(ev2);
    expect(handled2).toBe(true);
    expect(pd2).toHaveBeenCalled();
    expect(replaceUserInput).toHaveBeenLastCalledWith("second prompt", {
      start: "second prompt".length,
      end: "second prompt".length,
    });

    // 3rd ArrowUp -> should load "first prompt"
    const { event: ev3, preventDefault: pd3 } = createKeyPressEvent({
      key: "ArrowUp",
      text: "second prompt",
    });
    const handled3 = result.current.onKeyPress(ev3);
    expect(handled3).toBe(true);
    expect(pd3).toHaveBeenCalled();
    expect(replaceUserInput).toHaveBeenLastCalledWith("first prompt", {
      start: "first prompt".length,
      end: "first prompt".length,
    });

    // 4th ArrowUp at oldest prompt -> stays at "first prompt" (consumed, preventDefault called)
    const { event: ev4, preventDefault: pd4 } = createKeyPressEvent({
      key: "ArrowUp",
      text: "first prompt",
    });
    const handled4 = result.current.onKeyPress(ev4);
    expect(handled4).toBe(true);
    expect(pd4).toHaveBeenCalled();
  });

  it("navigates forwards on ArrowDown and restores draft", () => {
    const replaceUserInput = vi.fn();
    const { result } = renderHook(() =>
      useComposerPromptHistory({
        serverId: SERVER_ID,
        agentId: AGENT_ID,
        replaceUserInput,
      }),
    );

    // Start with a typed draft
    const initialDraft = "my unfinished draft";

    // ArrowUp -> saves draft and loads "third prompt"
    const { event: ev1 } = createKeyPressEvent({
      key: "ArrowUp",
      text: initialDraft,
    });
    result.current.onKeyPress(ev1);
    expect(replaceUserInput).toHaveBeenLastCalledWith("third prompt", {
      start: "third prompt".length,
      end: "third prompt".length,
    });

    // ArrowUp -> loads "second prompt"
    const { event: ev2 } = createKeyPressEvent({
      key: "ArrowUp",
      text: "third prompt",
    });
    result.current.onKeyPress(ev2);
    expect(replaceUserInput).toHaveBeenLastCalledWith("second prompt", {
      start: "second prompt".length,
      end: "second prompt".length,
    });

    // ArrowDown -> moves forward to "third prompt"
    const { event: evDown1, preventDefault: pdDown1 } = createKeyPressEvent({
      key: "ArrowDown",
      text: "second prompt",
    });
    const handledDown1 = result.current.onKeyPress(evDown1);
    expect(handledDown1).toBe(true);
    expect(pdDown1).toHaveBeenCalled();
    expect(replaceUserInput).toHaveBeenLastCalledWith("third prompt", {
      start: "third prompt".length,
      end: "third prompt".length,
    });

    // ArrowDown -> restores initial draft!
    const { event: evDown2, preventDefault: pdDown2 } = createKeyPressEvent({
      key: "ArrowDown",
      text: "third prompt",
    });
    const handledDown2 = result.current.onKeyPress(evDown2);
    expect(handledDown2).toBe(true);
    expect(pdDown2).toHaveBeenCalled();
    expect(replaceUserInput).toHaveBeenLastCalledWith(initialDraft, {
      start: initialDraft.length,
      end: initialDraft.length,
    });

    // Further ArrowDown when back at draft does nothing
    const { event: evDown3 } = createKeyPressEvent({
      key: "ArrowDown",
      text: initialDraft,
    });
    const handledDown3 = result.current.onKeyPress(evDown3);
    expect(handledDown3).toBe(false);
  });

  it("restores draft on Escape during history browsing", () => {
    const replaceUserInput = vi.fn();
    const { result } = renderHook(() =>
      useComposerPromptHistory({
        serverId: SERVER_ID,
        agentId: AGENT_ID,
        replaceUserInput,
      }),
    );

    const draft = "some draft";
    const { event: evUp } = createKeyPressEvent({
      key: "ArrowUp",
      text: draft,
    });
    result.current.onKeyPress(evUp);
    expect(replaceUserInput).toHaveBeenLastCalledWith("third prompt", expect.anything());

    // Press Escape -> restores draft
    const { event: evEsc, preventDefault: pdEsc } = createKeyPressEvent({
      key: "Escape",
      text: "third prompt",
    });
    const handledEsc = result.current.onKeyPress(evEsc);
    expect(handledEsc).toBe(true);
    expect(pdEsc).toHaveBeenCalled();
    expect(replaceUserInput).toHaveBeenLastCalledWith(draft, {
      start: draft.length,
      end: draft.length,
    });

    // Further Escape does nothing
    const { event: evEsc2 } = createKeyPressEvent({
      key: "Escape",
      text: draft,
    });
    expect(result.current.onKeyPress(evEsc2)).toBe(false);
  });

  it("does not intercept ArrowUp on multi-line text when cursor is not at (0, 0)", () => {
    const replaceUserInput = vi.fn();
    const { result } = renderHook(() =>
      useComposerPromptHistory({
        serverId: SERVER_ID,
        agentId: AGENT_ID,
        replaceUserInput,
      }),
    );

    const multilineText = "first line\nsecond line";
    const { event: ev } = createKeyPressEvent({
      key: "ArrowUp",
      text: multilineText,
      selection: { start: 15, end: 15 }, // in second line
    });

    const handled = result.current.onKeyPress(ev);
    expect(handled).toBe(false);
    expect(replaceUserInput).not.toHaveBeenCalled();
  });

  it("intercepts ArrowUp on multi-line text when cursor is at (0, 0)", () => {
    const replaceUserInput = vi.fn();
    const { result } = renderHook(() =>
      useComposerPromptHistory({
        serverId: SERVER_ID,
        agentId: AGENT_ID,
        replaceUserInput,
      }),
    );

    const multilineText = "first line\nsecond line";
    const { event: ev } = createKeyPressEvent({
      key: "ArrowUp",
      text: multilineText,
      selection: { start: 0, end: 0 },
    });

    const handled = result.current.onKeyPress(ev);
    expect(handled).toBe(true);
    expect(replaceUserInput).toHaveBeenCalledWith("third prompt", expect.anything());
  });

  it("records submitted prompt and resets navigation state", () => {
    const replaceUserInput = vi.fn();
    const { result } = renderHook(() =>
      useComposerPromptHistory({
        serverId: SERVER_ID,
        agentId: AGENT_ID,
        replaceUserInput,
      }),
    );

    // Submit a new prompt
    act(() => {
      result.current.recordSubmittedPrompt("fourth brand new prompt");
    });

    // ArrowUp should now return "fourth brand new prompt"
    const { event: evUp } = createKeyPressEvent({
      key: "ArrowUp",
      text: "",
    });
    result.current.onKeyPress(evUp);
    expect(replaceUserInput).toHaveBeenLastCalledWith("fourth brand new prompt", {
      start: "fourth brand new prompt".length,
      end: "fourth brand new prompt".length,
    });
  });

  it("ignores consecutive duplicate prompts", () => {
    const replaceUserInput = vi.fn();
    const { result } = renderHook(() =>
      useComposerPromptHistory({
        serverId: SERVER_ID,
        agentId: AGENT_ID,
        replaceUserInput,
      }),
    );

    act(() => {
      result.current.recordSubmittedPrompt("repeated prompt");
      result.current.recordSubmittedPrompt("repeated prompt");
      result.current.recordSubmittedPrompt("repeated prompt");
    });

    // 1st Up -> "repeated prompt"
    result.current.onKeyPress(createKeyPressEvent({ key: "ArrowUp", text: "" }).event);
    expect(replaceUserInput).toHaveBeenLastCalledWith("repeated prompt", expect.anything());

    // 2nd Up -> "third prompt" (not duplicate "repeated prompt")
    result.current.onKeyPress(
      createKeyPressEvent({ key: "ArrowUp", text: "repeated prompt" }).event,
    );
    expect(replaceUserInput).toHaveBeenLastCalledWith("third prompt", expect.anything());
  });

  it("falls back to global recent prompts when session has no history", () => {
    const replaceUserInput = vi.fn();
    // Use an agent ID with no messages
    const { result } = renderHook(() =>
      useComposerPromptHistory({
        serverId: SERVER_ID,
        agentId: "empty-agent",
        replaceUserInput,
      }),
    );

    // Before any global prompts -> ArrowUp does nothing
    const handledEmpty = result.current.onKeyPress(
      createKeyPressEvent({ key: "ArrowUp", text: "" }).event,
    );
    expect(handledEmpty).toBe(false);

    // Record a prompt
    act(() => {
      result.current.recordSubmittedPrompt("global fallback prompt");
    });

    // ArrowUp now picks it up
    const handledWithGlobal = result.current.onKeyPress(
      createKeyPressEvent({ key: "ArrowUp", text: "" }).event,
    );
    expect(handledWithGlobal).toBe(true);
    expect(replaceUserInput).toHaveBeenCalledWith("global fallback prompt", expect.anything());
  });
});
