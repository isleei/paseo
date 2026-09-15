import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RetainedPanelActivity } from "@/components/retained-panel";
import { i18n } from "@/i18n/i18next";
import type { ParsedDiffFile } from "@/git/use-diff-query";
import { ChangedFilesSection } from "./changed-files-section";

// App sources compile against the classic JSX runtime, which expects React on the global.
vi.stubGlobal("React", React);

function file(overrides: Partial<ParsedDiffFile> & { path: string }): ParsedDiffFile {
  return {
    oldPath: undefined,
    isNew: false,
    isDeleted: false,
    additions: 0,
    deletions: 0,
    hunks: [],
    ...overrides,
  };
}

const FILES: ParsedDiffFile[] = [
  file({ path: "scripts/mp-patch-efforts.mjs", additions: 174 }),
  file({ path: "src/old.ts", isDeleted: true, deletions: 21 }),
  file({ path: "src/new.ts", isNew: true, additions: 9 }),
];

const mounted: { root: Root; container: HTMLDivElement }[] = [];

/** Folding is not what this suite exercises; stable no-ops keep `Section` from re-rendering. */
function noop() {}

const EXPANDED: ReadonlySet<string> = new Set(["src/new.ts"]);

function mount(open: boolean): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <I18nextProvider i18n={i18n}>
        {/* The rail's roots never reuse the payload: the push router alone always owns `data`. */}
        <RetainedPanelActivity active>
          <ChangedFilesSection
            files={FILES}
            divided={false}
            isExpanded={open}
            onToggleExpanded={noop}
            expandedFilePaths={EXPANDED}
            onToggleFile={noop}
            openFile={noop}
          />
        </RetainedPanelActivity>
        ,
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

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    act(() => entry.root.unmount());
    entry.container.remove();
  }
});

describe("ChangedFilesSection", () => {
  it("counts the changed files in its header chip", () => {
    const container = mount(true);
    expect(
      container.querySelector('[data-testid="workspace-rail-changes-count"]')?.textContent,
    ).toBe("3");
  });

  it("lists each file with its own stat, dropping the half that did not move", () => {
    const texts = leafTexts(mount(true));
    expect(texts).toContain("+174");
    expect(texts).not.toContain("+0");
    expect(texts).toContain("−21");
  });

  it("marks added and deleted files distinctly", () => {
    const rows = [...mount(true).querySelectorAll('[data-testid^="workspace-rail-file-"]')].map(
      (el) => el.getAttribute("aria-label") ?? "",
    );
    expect(rows.some((label) => label.includes("src/new.ts"))).toBe(true);
    expect(rows.some((label) => label.includes("src/old.ts"))).toBe(true);
  });

  it("only renders the detail of the expanded file", () => {
    const container = mount(true);
    expect(
      container.querySelector('[data-testid="workspace-rail-file-open-src/new.ts"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="workspace-rail-file-open-src/old.ts"]'),
    ).toBeNull();
  });

  it("keeps the chip and drops the rows when the section is folded", () => {
    const container = mount(false);
    expect(
      container.querySelector('[data-testid="workspace-rail-changes-count"]')?.textContent,
    ).toBe("3");
    expect(leafTexts(container)).not.toContain("src/new.ts");
  });
});
