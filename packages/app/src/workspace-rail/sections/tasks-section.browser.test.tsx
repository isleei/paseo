import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/i18n/i18next";
import type { TodoEntry } from "@/types/stream";
import { TasksSection } from "./tasks-section";

// App sources compile against the classic JSX runtime, which expects React on the global.
beforeEach(() => vi.stubGlobal("React", React));

const TASKS: TodoEntry[] = [
  { text: "Invent the task list", completed: true },
  {
    text: "Write the rail",
    activeForm: "Writing the rail",
    completed: false,
    status: "in_progress",
  },
  { text: "Ship it", completed: false, status: "pending" },
];

const mounted: { root: Root; container: HTMLDivElement }[] = [];

/** Folding is not what this suite exercises; a stable no-op keeps `Section` from re-rendering. */
function noop() {}

function mount(tasks: TodoEntry[], open: boolean): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <I18nextProvider i18n={i18n}>
        <TasksSection tasks={tasks} divided={false} open={open} onToggle={noop} />
      </I18nextProvider>,
    ),
  );
  mounted.push({ root, container });
  return container;
}

function leafTexts(container: HTMLElement): string[] {
  return [...container.querySelectorAll("*")]
    .filter((el) => el.children.length === 0 && el.textContent?.trim())
    .map((el) => el.textContent ?? "");
}

function progressLabel(container: HTMLElement): string | null {
  return (
    container.querySelector('[data-testid="workspace-rail-task-progress"]')?.textContent ?? null
  );
}

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    act(() => entry.root.unmount());
    entry.container.remove();
  }
});

describe("TasksSection", () => {
  it("reports done against the whole list in its header chip", () => {
    expect(progressLabel(mount(TASKS, true))).toBe("1/3");
  });

  it("lists every task, preferring the running task's own wording", () => {
    const texts = leafTexts(mount(TASKS, true));
    expect(texts).toContain("Invent the task list");
    expect(texts).toContain("Writing the rail");
    expect(texts).toContain("Ship it");
    // The stored text is the completed-tense form; the running row must not fall back to it.
    expect(texts).not.toContain("Write the rail");
  });

  it("keeps the chip and drops the rows when the section is folded", () => {
    const container = mount(TASKS, false);
    expect(progressLabel(container)).toBe("1/3");
    expect(leafTexts(container)).not.toContain("Ship it");
  });
});
