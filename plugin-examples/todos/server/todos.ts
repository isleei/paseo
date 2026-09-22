import type { RpcInput } from "@getpaseo/plugin";
import { createTaskRpc, deleteTaskRpc, listTasksRpc, moveTaskRpc } from "../shared/todo";
import { createTask, deleteTask, listTasks, moveTask } from "./store";

export async function handleListTasks(_input: RpcInput<typeof listTasksRpc>) {
  return { tasks: await listTasks() };
}

export async function handleCreateTask(input: RpcInput<typeof createTaskRpc>) {
  return { task: await createTask({ title: input.title, goal: input.goal }) };
}

export async function handleMoveTask(input: RpcInput<typeof moveTaskRpc>) {
  const task = await moveTask(input.id, input.status);
  if (!task) throw new Error(`Unknown task: ${input.id}`);
  return { task };
}

export async function handleDeleteTask(input: RpcInput<typeof deleteTaskRpc>) {
  const deleted = await deleteTask(input.id);
  if (!deleted) throw new Error(`Unknown task: ${input.id}`);
  return { id: input.id };
}
