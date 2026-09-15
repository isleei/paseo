import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/i18n/i18next";
import type { RailArtifact, RailSkillUse, RailWebSource } from "@/workspace-rail/rail-state";
import { ArtifactsSection } from "./artifacts-section";
import { SkillsSection } from "./skills-section";
import { SourcesSection } from "./sources-section";

// App sources compile against the classic JSX runtime, which expects React on the global.
beforeEach(() => vi.stubGlobal("React", React));

const ARTIFACTS: RailArtifact[] = [
  { path: "packages/app/src/git/commit-sheet.tsx", kind: "produced" },
  { path: "packages/app/src/i18n/resources/en.ts", kind: "intermediate" },
];

const WEB_SOURCES: RailWebSource[] = [{ label: "Paseo", url: "https://paseo.sh" }];
const PROJECT_FILES = ["packages/app/src/workspace-rail/index.tsx"];
const SKILLS: RailSkillUse[] = [
  { name: "paseo", count: 2 },
  { name: "tdd", count: 1 },
];

const mounted: { root: Root; container: HTMLDivElement }[] = [];

function noop() {}

function mount(node: React.ReactElement): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>));
  mounted.push({ root, container });
  return container;
}

function leafTexts(container: HTMLElement): string[] {
  return [...container.querySelectorAll("*")]
    .filter((el) => el.children.length === 0 && el.textContent?.trim())
    .map((el) => el.textContent ?? "");
}

function chipText(container: HTMLElement, testID: string): string | null {
  return container.querySelector(`[data-testid="${testID}"]`)?.textContent ?? null;
}

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    act(() => entry.root.unmount());
    entry.container.remove();
  }
});

describe("SourcesSection", () => {
  function render(): HTMLElement {
    return mount(
      <SourcesSection
        webSources={WEB_SOURCES}
        projectFiles={PROJECT_FILES}
        uploadedCount={2}
        divided={false}
        isExpanded
        onToggleExpanded={noop}
        onOpenWebSource={noop}
        onOpenProjectFile={noop}
      />,
    );
  }

  it("counts every kind of reference it lists", () => {
    expect(chipText(render(), "workspace-rail-sources-count")).toBe("3");
  });

  it("groups each kind under its own heading", () => {
    const texts = leafTexts(render());
    expect(texts).toContain(i18n.t("workspace.git.rail.sourcesWeb"));
    expect(texts).toContain(i18n.t("workspace.git.rail.sourcesUpload"));
    expect(texts).toContain(i18n.t("workspace.git.rail.sourcesProject"));
  });

  it("titles a web source by its page title and a project file by its name", () => {
    const texts = leafTexts(render());
    expect(texts).toContain("Paseo");
    expect(texts).toContain("index.tsx");
  });

  it("reports the upload count the composer store holds, without listing each one", () => {
    expect(leafTexts(render())).toContain(i18n.t("workspace.git.rail.uploadedCount", { count: 2 }));
  });
});

describe("SkillsSection", () => {
  it("reports a skill once, with how many times it ran", () => {
    const container = mount(
      <SkillsSection skills={SKILLS} divided={false} isExpanded onToggleExpanded={noop} />,
    );
    const texts = leafTexts(container);
    expect(texts).toContain("paseo");
    expect(texts).toContain("×2");
    // A skill used once needs no multiplier; the absence of one is the information.
    expect(texts).not.toContain("×1");
  });

  it("counts distinct skills, not invocations", () => {
    const container = mount(
      <SkillsSection skills={SKILLS} divided={false} isExpanded onToggleExpanded={noop} />,
    );
    expect(chipText(container, "workspace-rail-skills-count")).toBe("2");
  });
});

describe("ArtifactsSection", () => {
  it("names the file, not the directories in front of it", () => {
    const container = mount(
      <ArtifactsSection
        artifacts={ARTIFACTS}
        divided={false}
        isExpanded
        onToggleExpanded={noop}
        onOpenArtifact={noop}
      />,
    );

    expect(leafTexts(container)).toContain("commit-sheet.tsx");
    expect(chipText(container, "workspace-rail-artifacts-count")).toBe("2");
  });

  it("keeps edited files under their own heading, since a write and an edit are not the same claim", () => {
    const container = mount(
      <ArtifactsSection
        artifacts={ARTIFACTS}
        divided={false}
        isExpanded
        onToggleExpanded={noop}
        onOpenArtifact={noop}
      />,
    );

    expect(leafTexts(container)).toContain(i18n.t("workspace.git.rail.artifactsIntermediate"));
    expect(leafTexts(container)).toContain("en.ts");
  });

  it("drops the rows but keeps the count when the section is folded", () => {
    const container = mount(
      <ArtifactsSection
        artifacts={ARTIFACTS}
        divided={false}
        isExpanded={false}
        onToggleExpanded={noop}
        onOpenArtifact={noop}
      />,
    );

    expect(chipText(container, "workspace-rail-artifacts-count")).toBe("2");
    expect(leafTexts(container)).not.toContain("commit-sheet.tsx");
  });
});
