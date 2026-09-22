import { describe, expect, it } from "vitest";
import type {
  SidebarProjectEntry,
  SidebarWorkspacePlacement,
} from "@/hooks/sidebar-workspaces-view-model";
import { splitPinnedSidebarGroups } from "@/hooks/use-sidebar-pins";

function placement(workspaceKey: string): SidebarWorkspacePlacement {
  return {
    workspaceKey,
    serverId: "s1",
    workspaceId: workspaceKey,
    projectViewKey: "p1",
    projectName: "Project 1",
    projectKind: "git",
    workspaceKind: "worktree",
    name: workspaceKey,
  };
}

function project(projectKey: string, workspaces: SidebarWorkspacePlacement[]): SidebarProjectEntry {
  return {
    viewKey: projectKey,
    projectName: projectKey,
    projectKind: "git",
    iconWorkingDir: "",
    hosts: [],
    workspaces,
  };
}

function hoistResult(
  projects: SidebarProjectEntry[],
  keys: Parameters<typeof splitPinnedSidebarGroups>[0]["keys"],
  pinnedWorkspaceOrder: string[] = [],
) {
  return splitPinnedSidebarGroups({
    projects,
    keys,
    pinnedWorkspaceOrder,
    hoistPinned: true,
  });
}

describe("splitPinnedSidebarGroups", () => {
  it("keeps the project shell reachable when every chat is pinned", () => {
    const only = placement("w1");
    const projects = [project("p1", [only])];
    const result = hoistResult(projects, {
      pinnedWorkspaceKeys: ["w1"],
      pinnedAtByKey: { w1: "2026-01-01T00:00:00Z" },
    });
    expect(result.pinnedChats).toHaveLength(1);
    expect(result.unpinnedProjects).toEqual([{ ...projects[0], workspaces: [] }]);
  });

  it("keeps a genuinely empty project so its new-workspace row stays reachable", () => {
    const projects = [project("p1", [])];
    const result = hoistResult(projects, { pinnedWorkspaceKeys: [], pinnedAtByKey: {} });
    expect(result.unpinnedProjects).toHaveLength(1);
  });

  it("keeps remaining chats when only some are pinned", () => {
    const projects = [project("p1", [placement("w1"), placement("w2")])];
    const result = hoistResult(projects, {
      pinnedWorkspaceKeys: ["w1"],
      pinnedAtByKey: { w1: "2026-01-01T00:00:00Z" },
    });
    expect(result.pinnedChats.map((w) => w.workspaceKey)).toEqual(["w1"]);
    expect(result.unpinnedProjects[0]?.workspaces.map((w) => w.workspaceKey)).toEqual(["w2"]);
  });

  it("orders pinned chats by most-recently-pinned first", () => {
    const projects = [project("p1", [placement("older"), placement("newer")])];
    const result = hoistResult(projects, {
      pinnedWorkspaceKeys: ["older", "newer"],
      pinnedAtByKey: {
        older: "2026-01-01T00:00:00Z",
        newer: "2026-02-01T00:00:00Z",
      },
    });

    expect(result.pinnedChats.map((workspace) => workspace.workspaceKey)).toEqual([
      "newer",
      "older",
    ]);
  });

  it("applies the saved order while keeping a newly pinned chat first", () => {
    const projects = [project("p1", [placement("older"), placement("newer"), placement("new")])];
    const result = hoistResult(
      projects,
      {
        pinnedWorkspaceKeys: ["older", "newer", "new"],
        pinnedAtByKey: {
          older: "2026-01-01T00:00:00Z",
          newer: "2026-02-01T00:00:00Z",
          new: "2026-03-01T00:00:00Z",
        },
      },
      ["older", "newer"],
    );

    expect(result.pinnedChats.map((workspace) => workspace.workspaceKey)).toEqual([
      "new",
      "older",
      "newer",
    ]);
  });

  it("keeps pinned chats inside their project instead of hoisting them", () => {
    const projects = [project("p1", [placement("w1"), placement("w2")])];
    const result = splitPinnedSidebarGroups({
      projects,
      keys: {
        pinnedWorkspaceKeys: ["w1"],
        pinnedAtByKey: { w1: "2026-01-01T00:00:00Z" },
      },
      pinnedWorkspaceOrder: [],
      hoistPinned: false,
    });

    expect(result.pinnedChats).toEqual([]);
    expect(
      result.unpinnedProjects[0]?.workspaces.map((workspace) => workspace.workspaceKey),
    ).toEqual(["w1", "w2"]);
  });

  it("pins in-project chats above unpinned ones, most recently pinned first", () => {
    const projects = [
      project("p1", [placement("unpinned"), placement("older"), placement("newer")]),
    ];
    const result = splitPinnedSidebarGroups({
      projects,
      keys: {
        pinnedWorkspaceKeys: ["older", "newer"],
        pinnedAtByKey: {
          older: "2026-01-01T00:00:00Z",
          newer: "2026-02-01T00:00:00Z",
        },
      },
      pinnedWorkspaceOrder: [],
      hoistPinned: false,
    });

    expect(
      result.unpinnedProjects[0]?.workspaces.map((workspace) => workspace.workspaceKey),
    ).toEqual(["newer", "older", "unpinned"]);
  });

  it("keeps each project's pin zone local when not hoisting", () => {
    const projects = [
      project("p1", [placement("p1-chat"), placement("p1-pinned")]),
      project("p2", [placement("p2-pinned"), placement("p2-chat")]),
    ];
    const result = splitPinnedSidebarGroups({
      projects,
      keys: {
        pinnedWorkspaceKeys: ["p1-pinned", "p2-pinned"],
        pinnedAtByKey: {
          "p1-pinned": "2026-01-01T00:00:00Z",
          "p2-pinned": "2026-02-01T00:00:00Z",
        },
      },
      pinnedWorkspaceOrder: [],
      hoistPinned: false,
    });

    expect(result.pinnedChats).toEqual([]);
    expect(
      result.unpinnedProjects[0]?.workspaces.map((workspace) => workspace.workspaceKey),
    ).toEqual(["p1-pinned", "p1-chat"]);
    expect(
      result.unpinnedProjects[1]?.workspaces.map((workspace) => workspace.workspaceKey),
    ).toEqual(["p2-pinned", "p2-chat"]);
  });

  it("applies the saved pin order inside a project while keeping a newly pinned chat first", () => {
    const projects = [
      project("p1", [
        placement("unpinned"),
        placement("older"),
        placement("newer"),
        placement("new"),
      ]),
    ];
    const result = splitPinnedSidebarGroups({
      projects,
      keys: {
        pinnedWorkspaceKeys: ["older", "newer", "new"],
        pinnedAtByKey: {
          older: "2026-01-01T00:00:00Z",
          newer: "2026-02-01T00:00:00Z",
          new: "2026-03-01T00:00:00Z",
        },
      },
      pinnedWorkspaceOrder: ["older", "newer"],
      hoistPinned: false,
    });

    expect(
      result.unpinnedProjects[0]?.workspaces.map((workspace) => workspace.workspaceKey),
    ).toEqual(["new", "older", "newer", "unpinned"]);
  });
});
