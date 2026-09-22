import type { PluginServerContext, PluginTurnOutcome } from "@getpaseo/plugin/server";
import { createDispatchHandler } from "./server/dispatch";
import { cancelActiveTaskRun, finishTaskRun, markTaskRunStarted } from "./server/store";
import {
  handleCreateTask,
  handleDeleteTask,
  handleListTasks,
  handleMoveTask,
} from "./server/todos";
import {
  createTaskRpc,
  deleteTaskRpc,
  dispatchTaskRpc,
  listTasksRpc,
  moveTaskRpc,
} from "./shared/todo";

function outcomeDetails(outcome: PluginTurnOutcome): {
  outcome: "completed" | "failed" | "canceled";
  error: string | null;
} {
  switch (outcome.kind) {
    case "completed":
      return { outcome: "completed", error: null };
    case "failed":
      return { outcome: "failed", error: outcome.error.message };
    case "canceled":
      return { outcome: "canceled", error: outcome.reason };
  }
}

export default function contribute(server: PluginServerContext) {
  server.handle(listTasksRpc, handleListTasks);
  server.handle(createTaskRpc, handleCreateTask);
  server.handle(moveTaskRpc, handleMoveTask);
  server.handle(deleteTaskRpc, handleDeleteTask);
  server.handle(dispatchTaskRpc, createDispatchHandler());

  server.on("agent.turn_started", async (event) => {
    await markTaskRunStarted(event.agent.id);
  });

  server.on("agent.turn_ended", async (event) => {
    const details = outcomeDetails(event.outcome);
    await finishTaskRun(event.agent.id, details.outcome, details.error);
  });

  server.on("agent.archived", async (event) => {
    await cancelActiveTaskRun(event.agent.id, "Agent archived");
  });

  return () => {};
}
