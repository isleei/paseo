import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/i18n/i18next";
import { EnvironmentSection } from "./environment-section";

vi.mock("@/runtime/host-runtime", () => ({
  useHosts: () => [],
}));

vi.mock("@/composer/workspace-diff-stat", () => ({
  useVisibleWorkspaceDiffStat: () => ({ additions: 3, deletions: 1 }),
}));

vi.mock("@/components/branch-switcher", () => ({
  BranchSwitcher: ({
    currentBranchName,
    renderTrigger,
    testID,
  }: {
    currentBranchName: string | null;
    renderTrigger?: (props: {
      onPress: () => void;
      label: string;
      testID?: string;
    }) => React.ReactNode;
    testID?: string;
  }) =>
    renderTrigger?.({
      onPress: () => {},
      label: currentBranchName ?? "main",
      testID,
    }) ?? null,
}));

vi.mock("./git-flyout", () => ({
  GitFlyout: () => null,
}));

beforeEach(() => vi.stubGlobal("React", React));

const mounted: { root: Root; container: HTMLDivElement }[] = [];

function noop() {}

const GIT = {
  branch: "main",
  isDirty: false,
  ahead: 0,
  behind: 0,
  hasRemote: true,
} as const;

function mount(): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <I18nextProvider i18n={i18n}>
        <EnvironmentSection
          serverId="local"
          cwd="/repo"
          workspaceId="ws-1"
          git={GIT}
          divided={false}
          open
          onToggle={noop}
          onOpenChanges={noop}
        />
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

describe("EnvironmentSection", () => {
  it("lists checkout facts without a pull request row", () => {
    const container = mount();
    const texts = leafTexts(container);

    expect(texts).toContain(i18n.t("workspace.git.rail.environmentInfo"));
    expect(texts).toContain(i18n.t("workspace.git.rail.changes"));
    expect(texts).toContain("main");
    expect(texts).toContain(i18n.t("workspace.git.rail.commitOrPush"));
    expect(container.querySelector('[data-testid="workspace-rail-commit"]')?.textContent).toContain(
      i18n.t("workspace.git.rail.commitOrPush"),
    );
    expect(container.querySelector('[data-testid="workspace-rail-pr"]')).toBeNull();
    expect(container.textContent).not.toContain("Pull request status unavailable");
    expect(container.textContent).not.toContain("无法获取拉取请求状态");
  });
});
