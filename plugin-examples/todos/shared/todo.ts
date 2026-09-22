import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const TaskStatusSchema = z.enum(["inbox", "planning", "in_progress", "review", "done"]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TASK_STATUSES: readonly TaskStatus[] = [
  "inbox",
  "planning",
  "in_progress",
  "review",
  "done",
];

export const TaskRunOutcomeSchema = z.enum(["running", "completed", "failed", "canceled"]);
export type TaskRunOutcome = z.infer<typeof TaskRunOutcomeSchema>;

export const TaskRunSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  agentId: z.string(),
  branch: z.string().nullable(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  outcome: TaskRunOutcomeSchema,
  error: z.string().nullable(),
});
export type TaskRun = z.infer<typeof TaskRunSchema>;

export const TaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  goal: z.string().optional(),
  status: TaskStatusSchema,
  runs: z.array(TaskRunSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().nullable(),
});
export type Task = z.infer<typeof TaskSchema>;

export function latestTaskRun(task: Task): TaskRun | null {
  return task.runs.at(-1) ?? null;
}

export const listTasksRpc = defineRpc({
  name: "tasks.list",
  input: z.object({}),
  output: z.object({ tasks: z.array(TaskSchema) }),
});

export const createTaskRpc = defineRpc({
  name: "tasks.create",
  input: z.object({ title: z.string().min(1), goal: z.string().optional() }),
  output: z.object({ task: TaskSchema }),
});

export const moveTaskRpc = defineRpc({
  name: "tasks.move",
  input: z.object({ id: z.string(), status: TaskStatusSchema }),
  output: z.object({ task: TaskSchema }),
});

export const dispatchTaskRpc = defineRpc({
  name: "tasks.dispatch",
  input: z.object({
    id: z.string(),
    cwd: z.string().min(1),
    provider: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    prompt: z.string().optional(),
  }),
  output: z.object({ task: TaskSchema }),
});

export const deleteTaskRpc = defineRpc({
  name: "tasks.delete",
  input: z.object({ id: z.string() }),
  output: z.object({ id: z.string() }),
});
