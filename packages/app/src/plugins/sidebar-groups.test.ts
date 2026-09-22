import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { EvaluatedPluginWorkspacePanelContribution, InstalledPlugin } from "./types";
import {
  groupPluginSidebarContributions,
  groupPluginSidebarPanelContributions,
} from "./sidebar-groups";

type WorkspacePanel = Extract<EvaluatedPluginWorkspacePanelContribution, { context: "workspace" }>;

function panel(overrides: Partial<WorkspacePanel> = {}): WorkspacePanel {
  return {
    id: "details",
    title: "Details",
    icon: "Scan",
    context: "workspace",
    locations: ["workspace"],
    sidebar: false,
    Component: () => null,
    ...overrides,
  };
}

function installed(serverId: string, contributionId = "main"): InstalledPlugin {
  return {
    id: "example",
    cleanup: () => undefined,
    serverId,
    clientBundle: serverId,
    lifetime: new AbortController(),
    queryClient: new QueryClient(),
    settingsScreens: [],
    surfaces: [{ id: "surface", Component: () => null }],
    sidebarItems: [
      {
        id: contributionId,
        title: "Example",
        icon: "Blocks",
        surface: "surface",
      },
    ],
    workspacePanels: [],
    commandCenterItems: [],
    clientSlashCommands: [],
    attachmentSources: [],
    themes: [],
    timelineTransformers: [],
    timelineRenderers: [],
  };
}

describe("groupPluginSidebarContributions", () => {
  it("coalesces the same plugin contribution across hosts", () => {
    const groups = groupPluginSidebarContributions([installed("host-a"), installed("host-b")]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.targets.map((target) => target.plugin.serverId)).toEqual([
      "host-a",
      "host-b",
    ]);
  });

  it("keeps different contribution ids separate", () => {
    const groups = groupPluginSidebarContributions([
      installed("host-a", "main"),
      installed("host-b", "settings"),
    ]);

    expect(groups.map((group) => group.key)).toEqual([
      "example/sidebar/main",
      "example/sidebar/settings",
    ]);
  });
});

describe("groupPluginSidebarPanelContributions", () => {
  function installedWithPanels(
    serverId: string,
    panels: EvaluatedPluginWorkspacePanelContribution[],
  ): InstalledPlugin {
    return { ...installed(serverId), sidebarItems: [], workspacePanels: panels };
  }

  it("only groups workspace panels that opted into the sidebar", () => {
    const groups = groupPluginSidebarPanelContributions([
      installedWithPanels("host-a", [
        panel({ id: "details", sidebar: true }),
        panel({ id: "hidden" }),
      ]),
    ]);

    expect(groups.map((group) => group.key)).toEqual(["example/panel/details"]);
  });

  it("skips agent panels even when they opt into the sidebar", () => {
    const agentPanel: EvaluatedPluginWorkspacePanelContribution = {
      ...panel(),
      context: "agent",
      Component: () => null,
    };
    const groups = groupPluginSidebarPanelContributions([
      installedWithPanels("host-a", [agentPanel]),
    ]);

    expect(groups).toEqual([]);
  });

  it("coalesces the same panel across hosts", () => {
    const groups = groupPluginSidebarPanelContributions([
      installedWithPanels("host-a", [panel({ sidebar: true })]),
      installedWithPanels("host-b", [panel({ sidebar: true })]),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.targets.map((target) => target.plugin.serverId)).toEqual([
      "host-a",
      "host-b",
    ]);
  });
});
