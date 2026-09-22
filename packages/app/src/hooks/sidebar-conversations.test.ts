import { describe, expect, it } from "vitest";
import type {
  SidebarProjectEntry,
  SidebarWorkspacePlacement,
} from "./sidebar-workspaces-view-model";
import {
  countWorkspaceRootConversations,
  expandProjectsIntoConversations,
  isWorkspaceBackedOneToOne,
  resolveArchiveForSidebarRow,
  resolveConversationPinnedAt,
  resolveSidebarArchiveTarget,
  type SidebarConversationAgent,
} from "./sidebar-conversations";

function placement(workspaceId: string): SidebarWorkspacePlacement {
  return {
    workspaceKey: `s1:${workspaceId}`,
    serverId: "s1",
    workspaceId,
    projectViewKey: "p1",
    projectName: "Project",
    projectKind: "git",
    workspaceKind: "worktree",
    name: workspaceId,
  };
}

function project(workspaces: SidebarWorkspacePlacement[]): SidebarProjectEntry {
  return {
    viewKey: "p1",
    projectKey: "proj-key",
    projectName: "Project",
    projectKind: "git",
    iconWorkingDir: "/repo",
    hosts: [
      { serverId: "s1", projectId: "proj", iconWorkingDir: "/repo", worktreeSupport: "supported" },
    ],
    workspaces,
  };
}

function agent(
  id: string,
  workspaceId?: string,
  extra?: Partial<Omit<SidebarConversationAgent, "id" | "workspaceId" | "serverId">>,
): SidebarConversationAgent {
  return {
    serverId: "s1",
    id,
    workspaceId,
    parentAgentId: extra?.parentAgentId ?? null,
    title: extra?.title ?? id,
    createdAtMs: extra?.createdAtMs ?? 1,
    archivedAt: extra?.archivedAt ?? null,
    projectKey: extra?.projectKey,
    projectName: extra?.projectName,
    cwd: extra?.cwd,
    statusBucket: extra?.statusBucket,
    statusEnteredAt: extra?.statusEnteredAt,
  };
}

describe("expandProjectsIntoConversations", () => {
  it("keeps a workspace with no agents as a single row", () => {
    const projects = [project([placement("ws-1")])];
    const result = expandProjectsIntoConversations({ projects, agents: [] });
    expect(result[0]?.workspaces).toEqual([placement("ws-1")]);
  });

  it("keeps a single root agent on the original workspace key", () => {
    const projects = [project([placement("ws-1")])];
    const result = expandProjectsIntoConversations({
      projects,
      agents: [agent("chat-1", "ws-1", { title: "Fix login" })],
    });
    expect(result[0]?.workspaces).toEqual([
      {
        ...placement("ws-1"),
        agentId: "chat-1",
        conversationTitle: "Fix login",
      },
    ]);
  });

  it("splits a workspace into one row per root agent, newest first", () => {
    const projects = [project([placement("ws-1")])];
    const result = expandProjectsIntoConversations({
      projects,
      agents: [
        agent("older", "ws-1", { title: "Older", createdAtMs: 1 }),
        agent("newer", "ws-1", { title: "Newer", createdAtMs: 2 }),
      ],
    });
    expect(result[0]?.workspaces.map((row) => row.workspaceKey)).toEqual([
      "s1:ws-1:a:newer",
      "s1:ws-1:a:older",
    ]);
    expect(result[0]?.workspaces.map((row) => row.agentId)).toEqual(["newer", "older"]);
    expect(result[0]?.workspaces.map((row) => row.conversationTitle)).toEqual(["Newer", "Older"]);
  });

  it("carries each conversation's status into its row", () => {
    const statusEnteredAt = new Date("2026-07-01T00:00:00Z");
    const projects = [project([placement("ws-1")])];
    const result = expandProjectsIntoConversations({
      projects,
      agents: [
        agent("chat-1", "ws-1", {
          statusBucket: "needs_input",
          statusEnteredAt,
        }),
      ],
    });

    expect(result[0]?.workspaces[0]).toMatchObject({
      agentId: "chat-1",
      statusBucket: "needs_input",
      statusEnteredAt,
    });
  });

  it("does not list a same-workspace subagent as its own row", () => {
    const projects = [project([placement("ws-1")])];
    const result = expandProjectsIntoConversations({
      projects,
      agents: [
        agent("root", "ws-1", { title: "Root" }),
        agent("child", "ws-1", { title: "Child", parentAgentId: "root" }),
      ],
    });
    expect(result[0]?.workspaces.map((row) => row.agentId)).toEqual(["root"]);
  });

  it("lists a cross-workspace child as its own conversation", () => {
    const projects = [project([placement("ws-1"), placement("ws-2")])];
    const result = expandProjectsIntoConversations({
      projects,
      agents: [
        agent("root", "ws-1", { title: "Root" }),
        agent("child", "ws-2", { title: "Child", parentAgentId: "root" }),
      ],
    });
    expect(
      result[0]?.workspaces.map((row) => ({ id: row.workspaceId, agentId: row.agentId })),
    ).toEqual([
      { id: "ws-1", agentId: "root" },
      { id: "ws-2", agentId: "child" },
    ]);
  });

  it("skips archived agents", () => {
    const projects = [project([placement("ws-1")])];
    const result = expandProjectsIntoConversations({
      projects,
      agents: [agent("gone", "ws-1", { archivedAt: new Date("2026-01-01T00:00:00Z") })],
    });
    expect(result[0]?.workspaces[0]?.agentId).toBeUndefined();
  });

  it("adds standalone sessions to the matching project", () => {
    const projects = [project([placement("ws-1")])];
    const result = expandProjectsIntoConversations({
      projects,
      agents: [
        agent("solo", undefined, {
          title: "Ask about auth",
          projectKey: "proj-key",
          statusBucket: "running",
        }),
      ],
    });
    expect(result[0]?.workspaces.map((row) => row.workspaceKey)).toEqual([
      "s1:ws-1",
      "s1:standalone:solo",
    ]);
    expect(result[0]?.workspaces[1]).toMatchObject({
      agentId: "solo",
      standalone: true,
      conversationTitle: "Ask about auth",
      statusBucket: "running",
    });
  });

  it("matches standalone sessions by cwd when projectKey is missing", () => {
    const projects = [project([])];
    const result = expandProjectsIntoConversations({
      projects,
      agents: [agent("solo", undefined, { title: "Notes", cwd: "/repo/packages/app" })],
    });
    expect(result[0]?.workspaces).toEqual([
      expect.objectContaining({
        workspaceKey: "s1:standalone:solo",
        standalone: true,
        agentId: "solo",
      }),
    ]);
  });

  it("creates a project group for an unmatched standalone session", () => {
    const result = expandProjectsIntoConversations({
      projects: [],
      agents: [
        agent("solo", undefined, {
          title: "Notes",
          cwd: "/tmp/notes",
          createdAtMs: 10,
        }),
      ],
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      isSynthetic: true,
      projectName: "notes",
      iconWorkingDir: "/tmp/notes",
      workspaces: [
        expect.objectContaining({
          workspaceKey: "s1:standalone:solo",
          standalone: true,
          agentId: "solo",
        }),
      ],
    });
  });
});

describe("resolveSidebarArchiveTarget", () => {
  it("archives the workspace when it is the only conversation", () => {
    expect(resolveSidebarArchiveTarget({ agentId: "chat-1", siblingConversationCount: 1 })).toEqual(
      { kind: "workspace" },
    );
  });

  it("archives only that agent when siblings remain", () => {
    expect(resolveSidebarArchiveTarget({ agentId: "chat-1", siblingConversationCount: 2 })).toEqual(
      { kind: "agent", agentId: "chat-1" },
    );
  });

  it("archives the workspace when the row has no agent", () => {
    expect(resolveSidebarArchiveTarget({ agentId: null, siblingConversationCount: 2 })).toEqual({
      kind: "workspace",
    });
  });
});

describe("resolveArchiveForSidebarRow", () => {
  it("archives one sibling conversation without taking the workspace", () => {
    expect(
      resolveArchiveForSidebarRow({
        agentId: "a",
        workspaceId: "ws-1",
        agents: [agent("a", "ws-1"), agent("b", "ws-1")],
      }),
    ).toEqual({ kind: "agent", agentId: "a" });
  });

  it("archives the workspace for the last conversation", () => {
    expect(
      resolveArchiveForSidebarRow({
        agentId: "a",
        workspaceId: "ws-1",
        agents: [agent("a", "ws-1")],
      }),
    ).toEqual({ kind: "workspace" });
  });

  it("archives a standalone session as an agent", () => {
    expect(
      resolveArchiveForSidebarRow({
        agentId: "solo",
        workspaceId: "",
        standalone: true,
        agents: [agent("solo")],
      }),
    ).toEqual({ kind: "agent", agentId: "solo" });
  });
});

describe("resolveConversationPinnedAt", () => {
  it("prefers the conversation pin over the workspace pin", () => {
    expect(
      resolveConversationPinnedAt({
        placement: placement("ws-1"),
        conversationPinnedAt: "2026-04-01T00:00:00Z",
        workspacePinnedAt: "2026-01-01T00:00:00Z",
      }),
    ).toBe("2026-04-01T00:00:00Z");
  });

  it("inherits workspace pin only for a 1:1 workspace row", () => {
    expect(
      resolveConversationPinnedAt({
        placement: placement("ws-1"),
        workspacePinnedAt: "2026-01-01T00:00:00Z",
      }),
    ).toBe("2026-01-01T00:00:00Z");
    expect(
      resolveConversationPinnedAt({
        placement: {
          ...placement("ws-1"),
          workspaceKey: "s1:ws-1:a:chat",
          agentId: "chat",
        },
        workspacePinnedAt: "2026-01-01T00:00:00Z",
      }),
    ).toBeNull();
    expect(
      resolveConversationPinnedAt({
        placement: {
          ...placement("ws-1"),
          workspaceId: "",
          workspaceKey: "s1:standalone:solo",
          standalone: true,
        },
        workspacePinnedAt: "2026-01-01T00:00:00Z",
      }),
    ).toBeNull();
  });
});

describe("isWorkspaceBackedOneToOne", () => {
  it("is true only for an unsplitting workspace row", () => {
    expect(isWorkspaceBackedOneToOne(placement("ws-1"))).toBe(true);
    expect(
      isWorkspaceBackedOneToOne({
        ...placement("ws-1"),
        workspaceKey: "s1:ws-1:a:chat",
      }),
    ).toBe(false);
    expect(
      isWorkspaceBackedOneToOne({
        ...placement("ws-1"),
        standalone: true,
      }),
    ).toBe(false);
  });
});

describe("countWorkspaceRootConversations", () => {
  it("counts live root agents in one workspace", () => {
    expect(
      countWorkspaceRootConversations({
        workspaceId: "ws-1",
        agents: [
          agent("a", "ws-1"),
          agent("b", "ws-1"),
          agent("child", "ws-1", { parentAgentId: "a" }),
          agent("other", "ws-2"),
        ],
      }),
    ).toBe(2);
  });
});
