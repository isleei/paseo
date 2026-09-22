import type { RpcInput } from "@getpaseo/plugin";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { dispatchTaskRpc, latestTaskRun } from "../shared/todo";
import { findRepoRoot, toBranchName } from "./git";
import { defaultModelFromEnv, defaultProviderFromEnv, toProviderModel } from "./provider-model";
import { finishTaskRun, getTask, recordTaskRun } from "./store";

const dispatchesInFlight = new Set<string>();

export function createDispatchHandler() {
  return async (input: RpcInput<typeof dispatchTaskRpc>, context: PluginHandlerContext) => {
    if (dispatchesInFlight.has(input.id)) throw new Error("This task is already being dispatched");
    dispatchesInFlight.add(input.id);

    try {
      const task = await getTask(input.id);
      if (!task) throw new Error(`Unknown task: ${input.id}`);
      if (task.status === "done")
        throw new Error("Move this task out of Done before running it again");
      if (latestTaskRun(task)?.outcome === "running") {
        throw new Error("This task already has a running agent");
      }

      const providerModel = toProviderModel(
        input.provider ?? defaultProviderFromEnv() ?? "",
        input.model ?? defaultModelFromEnv(),
      );
      const repoRoot = await findRepoRoot(input.cwd);
      const branchName = repoRoot ? toBranchName(task.title, task.id, task.runs.length + 1) : null;
      const workspace = await context.paseo.workspaces.create({
        title: task.title,
        source:
          branchName && repoRoot
            ? {
                kind: "worktree" as const,
                cwd: repoRoot,
                action: "branch-off" as const,
                branchName,
              }
            : { kind: "directory" as const, path: input.cwd },
      });

      let agent;
      try {
        agent = await workspace.agents.create({
          config: { provider: providerModel },
          title: task.title,
        });
      } catch (error) {
        await workspace.archive().catch(() => undefined);
        throw error;
      }

      let bound;
      try {
        bound = await recordTaskRun(task.id, {
          workspaceId: workspace.id,
          agentId: agent.id,
          branch: branchName,
        });
        if (!bound) throw new Error(`Task disappeared during dispatch: ${input.id}`);
      } catch (error) {
        await agent.archive().catch(() => undefined);
        await workspace.archive().catch(() => undefined);
        throw error;
      }

      try {
        await agent.send(input.prompt ?? task.goal ?? task.title);
        return { task: (await getTask(task.id)) ?? bound };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await finishTaskRun(agent.id, "failed", message).catch(() => undefined);
        await agent.archive().catch(() => undefined);
        await workspace.archive().catch(() => undefined);
        throw error;
      }
    } finally {
      dispatchesInFlight.delete(input.id);
    }
  };
}

export type DispatchHandler = ReturnType<typeof createDispatchHandler>;
