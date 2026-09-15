import { describe, expect, it } from "vitest";
import type { ToolCallDetail } from "@getpaseo/protocol/agent-types";
import type { CheckoutStatusPayload } from "@/git/use-status-query";
import {
  countCompletedTasks,
  deriveRailGitState,
  deriveRailSessionDerived,
  formatDiffStat,
  formatUpstreamDelta,
  isSectionOpen,
  selectRailSections,
  toggleSectionId,
} from "@/workspace-rail/rail-state";
import type { StreamItem, TodoEntry } from "@/types/stream";

function gitStatus(overrides: Partial<CheckoutStatusPayload> = {}): CheckoutStatusPayload {
  return {
    cwd: "/tmp/repo",
    isGit: true,
    isPaseoOwnedWorktree: false,
    repoRoot: "/tmp/repo",
    currentBranch: "main",
    isDirty: false,
    baseRef: "main",
    aheadBehind: null,
    aheadOfOrigin: 0,
    behindOfOrigin: 0,
    hasRemote: true,
    remoteUrl: "git@github.com:getpaseo/paseo.git",
    error: null,
    requestId: "req-1",
    ...overrides,
  } as CheckoutStatusPayload;
}

describe("deriveRailGitState", () => {
  it("reads nothing out of a checkout that is not a git repo", () => {
    expect(deriveRailGitState(null)).toBeNull();
    expect(
      deriveRailGitState({
        isGit: false,
        cwd: "/tmp",
        error: null,
        requestId: "r",
      } as CheckoutStatusPayload),
    ).toBeNull();
  });

  it("carries the branch and the upstream delta", () => {
    const state = deriveRailGitState(gitStatus({ currentBranch: "feat/rail", aheadOfOrigin: 2 }));
    expect(state).toEqual({
      branch: "feat/rail",
      isDirty: false,
      ahead: 2,
      behind: 0,
      hasRemote: true,
    });
  });

  it("reports a detached HEAD as a null branch rather than an empty name", () => {
    expect(deriveRailGitState(gitStatus({ currentBranch: null }))?.branch).toBeNull();
  });
});

describe("formatUpstreamDelta", () => {
  const base = { branch: "main", isDirty: false, ahead: 0, behind: 0, hasRemote: true };

  it("drops a half that is zero, so a level branch reads as nothing rather than as ↑0", () => {
    expect(formatUpstreamDelta(base)).toBeNull();
    expect(formatUpstreamDelta({ ...base, ahead: 2 })).toBe("↑2");
    expect(formatUpstreamDelta({ ...base, behind: 3 })).toBe("↓3");
    expect(formatUpstreamDelta({ ...base, ahead: 2, behind: 3 })).toBe("↑2 ↓3");
  });

  it("drops a half the daemon could not measure", () => {
    expect(formatUpstreamDelta({ ...base, ahead: null, behind: 1 })).toBe("↓1");
  });
});

describe("formatDiffStat", () => {
  it("names only the half that moved", () => {
    expect(formatDiffStat({ additions: 174, deletions: 0 })).toBe("+174");
    expect(formatDiffStat({ additions: 0, deletions: 21 })).toBe("−21");
    expect(formatDiffStat({ additions: 174, deletions: 21 })).toBe("+174 −21");
  });

  it("says nothing when the tree is clean or the stat is missing", () => {
    expect(formatDiffStat({ additions: 0, deletions: 0 })).toBeNull();
    expect(formatDiffStat(null)).toBeNull();
    expect(formatDiffStat(undefined)).toBeNull();
  });
});

describe("countCompletedTasks", () => {
  it("counts both spellings of done, matching how the row renders them", () => {
    const tasks: TodoEntry[] = [
      { text: "a", completed: true },
      { text: "b", completed: false, status: "completed" },
      { text: "c", completed: false, status: "in_progress" },
      { text: "d", completed: false, status: "pending" },
    ];
    expect(countCompletedTasks(tasks)).toEqual({ completed: 2, total: 4 });
  });

  it("reports an empty list as 0/0", () => {
    expect(countCompletedTasks([])).toEqual({ completed: 0, total: 0 });
  });
});

describe("selectRailSections", () => {
  const none = { taskCount: 0, changeCount: 0, artifactCount: 0, sourceCount: 0, skillCount: 0 };

  it("keeps the rail's order and drops what has nothing to show", () => {
    expect(selectRailSections({ ...none, isGit: true, commitCount: 0 })).toEqual(["environment"]);
    expect(
      selectRailSections({ ...none, taskCount: 3, changeCount: 2, isGit: true, commitCount: 2 }),
    ).toEqual(["tasks", "changes", "environment", "commits"]);
  });

  it("drops the whole rail when the checkout is not a repo and nothing else is happening", () => {
    expect(selectRailSections({ ...none, isGit: false, commitCount: 0 })).toEqual([]);
  });

  it("shows tasks without a repo, so a scratch directory still reports its work", () => {
    expect(selectRailSections({ ...none, taskCount: 2, isGit: false, commitCount: 0 })).toEqual([
      "tasks",
    ]);
  });

  it("shows commits without a task list, which is the usual shape of a working branch", () => {
    expect(selectRailSections({ ...none, isGit: true, commitCount: 4 })).toEqual([
      "environment",
      "commits",
    ]);
  });

  it("shows changes ahead of the environment block, so the changed files sit at the top of the git state", () => {
    expect(selectRailSections({ ...none, changeCount: 3, isGit: true, commitCount: 0 })).toEqual([
      "changes",
      "environment",
    ]);
  });

  it("shows what the session produced without needing a repo, since a scratch run still has output", () => {
    expect(
      selectRailSections({
        ...none,
        artifactCount: 2,
        sourceCount: 1,
        skillCount: 3,
        isGit: false,
        commitCount: 0,
      }),
    ).toEqual(["artifacts", "sources", "skills"]);
  });

  it("stacks the session's output between the git state's files and its branch block", () => {
    expect(selectRailSections({ ...none, artifactCount: 1, isGit: true, commitCount: 0 })).toEqual([
      "artifacts",
      "environment",
    ]);
  });
});

describe("section folding", () => {
  it("treats an absent id as open, so a new section starts expanded", () => {
    expect(isSectionOpen([], "environment")).toBe(true);
    expect(isSectionOpen(["environment"], "environment")).toBe(false);
  });

  it("toggles one id without disturbing the others", () => {
    const closed = toggleSectionId(["tasks"], "environment");
    expect(closed).toEqual(["tasks", "environment"]);
    expect(toggleSectionId(closed, "tasks")).toEqual(["environment"]);
  });

  it("is a no-op when the same id is toggled twice", () => {
    expect(toggleSectionId(toggleSectionId([], "subagents"), "subagents")).toEqual([]);
  });
});

function toolCall(
  name: string,
  detail: ToolCallDetail,
  id = `${name}-${Math.random()}`,
): StreamItem {
  return {
    kind: "tool_call",
    id,
    timestamp: new Date(0),
    payload: {
      source: "agent",
      data: {
        provider: "claude",
        callId: id,
        name,
        status: "completed",
        error: null,
        detail,
      },
    },
  } as StreamItem;
}

describe("deriveRailSessionDerived", () => {
  it("splits written files from edited ones, newest first", () => {
    const derived = deriveRailSessionDerived([
      toolCall("Write", { type: "write", filePath: "src/old.ts" }, "a"),
      toolCall("Edit", { type: "edit", filePath: "src/edited.ts" }, "b"),
      toolCall("Write", { type: "write", filePath: "src/new.ts" }, "c"),
    ]);

    expect(derived.artifacts).toEqual([
      { path: "src/new.ts", kind: "produced" },
      { path: "src/edited.ts", kind: "intermediate" },
      { path: "src/old.ts", kind: "produced" },
    ]);
  });

  it("names a file once however many times the session touched it", () => {
    const derived = deriveRailSessionDerived([
      toolCall("Write", { type: "write", filePath: "src/a.ts" }, "a"),
      toolCall("Edit", { type: "edit", filePath: "src/a.ts" }, "b"),
      toolCall("Write", { type: "write", filePath: "src/a.ts" }, "c"),
    ]);

    expect(derived.artifacts).toEqual([{ path: "src/a.ts", kind: "produced" }]);
  });

  it("reads web results and fetches into one source list, keyed by url", () => {
    const derived = deriveRailSessionDerived([
      toolCall(
        "WebSearch",
        {
          type: "search",
          query: "paseo",
          toolName: "web_search",
          webResults: [{ title: "Paseo", url: "https://paseo.sh" }],
        },
        "a",
      ),
      toolCall("WebFetch", { type: "fetch", url: "https://paseo.sh" }, "b"),
      toolCall("WebFetch", { type: "fetch", url: "https://docs.paseo.sh" }, "c"),
    ]);

    expect(derived.webSources).toEqual([
      { label: "https://docs.paseo.sh", url: "https://docs.paseo.sh" },
      { label: "Paseo", url: "https://paseo.sh" },
    ]);
  });

  it("keeps a search on the project out of the source list, since it reached no web page", () => {
    const derived = deriveRailSessionDerived([
      toolCall("Grep", { type: "search", query: "todo", toolName: "grep" }, "a"),
    ]);

    expect(derived.webSources).toEqual([]);
  });

  it("lists the files the session read, without repeating one", () => {
    const derived = deriveRailSessionDerived([
      toolCall("Read", { type: "read", filePath: "src/a.ts" }, "a"),
      toolCall("Read", { type: "read", filePath: "src/b.ts" }, "b"),
      toolCall("Read", { type: "read", filePath: "src/a.ts" }, "c"),
    ]);

    expect(derived.projectFiles).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("counts a skill once per name and takes its name from the parsed label", () => {
    const derived = deriveRailSessionDerived([
      toolCall("Skill", { type: "plain_text", label: "paseo", icon: "sparkles" }, "a"),
      toolCall("Skill", { type: "plain_text", label: "paseo", icon: "sparkles" }, "b"),
      toolCall("Skill", { type: "plain_text", label: "tdd", icon: "sparkles" }, "c"),
    ]);

    expect(derived.skills).toEqual([
      { name: "paseo", count: 2 },
      { name: "tdd", count: 1 },
    ]);
  });

  it("falls back to the tool name when a provider reports a skill without a label", () => {
    const derived = deriveRailSessionDerived([
      toolCall("skill", { type: "unknown", input: {}, output: {} }, "a"),
    ]);

    expect(derived.skills).toEqual([{ name: "skill", count: 1 }]);
  });

  it("ignores non-tool items and orchestrator calls, which are not the agent's own work", () => {
    const derived = deriveRailSessionDerived([
      { kind: "notification", id: "n", timestamp: new Date(0), level: "info", message: "hi" },
      toolCall("Shell", { type: "shell", command: "ls" }, "s"),
    ] as StreamItem[]);

    expect(derived).toEqual({ artifacts: [], webSources: [], projectFiles: [], skills: [] });
  });
});
