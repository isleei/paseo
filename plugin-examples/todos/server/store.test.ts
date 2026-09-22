import { describe, expect, it, vi } from "vitest";
import { parseStoredTasks } from "./store";

describe("task store migration", () => {
  it("preserves a legacy todo and its agent binding as task execution history", () => {
    const result = parseStoredTasks({
      todos: [
        {
          id: "td_123",
          title: "Review release",
          goal: "Check the beta before promotion",
          status: "review",
          workspaceId: "workspace-1",
          agentId: "agent-1",
          branch: "todos/review-release-123",
          updatedAt: "2026-09-19T08:00:00.000Z",
        },
      ],
    });

    expect(result).toEqual({
      migrated: true,
      tasks: [
        {
          id: "td_123",
          title: "Review release",
          goal: "Check the beta before promotion",
          status: "review",
          createdAt: "2026-09-19T08:00:00.000Z",
          updatedAt: "2026-09-19T08:00:00.000Z",
          completedAt: null,
          runs: [
            {
              id: "run_legacy_td_123",
              workspaceId: "workspace-1",
              agentId: "agent-1",
              branch: "todos/review-release-123",
              startedAt: "2026-09-19T08:00:00.000Z",
              finishedAt: "2026-09-19T08:00:00.000Z",
              outcome: "completed",
              error: null,
            },
          ],
        },
      ],
    });
  });

  it("maps an in-flight legacy todo to an active task execution", () => {
    const result = parseStoredTasks({
      todos: [
        {
          id: "td_456",
          title: "Implement task inbox",
          status: "building",
          workspaceId: "workspace-2",
          agentId: "agent-2",
          updatedAt: "2026-09-19T09:00:00.000Z",
        },
      ],
    });

    expect(result.tasks[0]?.status).toBe("in_progress");
    expect(result.tasks[0]?.runs[0]).toMatchObject({
      outcome: "running",
      finishedAt: null,
    });
  });

  it("rejects malformed data instead of silently replacing it", () => {
    expect(() => parseStoredTasks({ todos: [{ title: "missing id" }] })).toThrow(
      "Tasks store is invalid",
    );
  });

  it("persists repeated executions independently from the task", async () => {
    const { mkdtemp, readFile, rm } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const previousHome = process.env.PASEO_HOME;
    const home = await mkdtemp(join(tmpdir(), "paseo-tasks-test-"));
    process.env.PASEO_HOME = home;

    try {
      vi.resetModules();
      const store = await import("./store");
      const task = await store.createTask({ title: "Ship task inbox" });
      const firstRun = await store.recordTaskRun(task.id, {
        workspaceId: "workspace-1",
        agentId: "agent-1",
        branch: "tasks/ship-task-inbox-1-r1",
      });
      expect(firstRun?.status).toBe("in_progress");

      await store.finishTaskRun("agent-1", "completed", null);
      const secondRun = await store.recordTaskRun(task.id, {
        workspaceId: "workspace-2",
        agentId: "agent-2",
        branch: "tasks/ship-task-inbox-1-r2",
      });
      await store.finishTaskRun("agent-2", "failed", "Review failed");

      const persisted = JSON.parse(
        await readFile(join(home, "plugins", "todos", "tasks.json"), "utf8"),
      );
      expect(secondRun?.runs).toHaveLength(2);
      expect(persisted).toMatchObject({
        version: 2,
        tasks: [
          {
            id: task.id,
            status: "review",
            runs: [
              { agentId: "agent-1", outcome: "completed" },
              { agentId: "agent-2", outcome: "failed", error: "Review failed" },
            ],
          },
        ],
      });
    } finally {
      if (previousHome === undefined) delete process.env.PASEO_HOME;
      else process.env.PASEO_HOME = previousHome;
      vi.resetModules();
      await rm(home, { recursive: true, force: true });
    }
  });
});
