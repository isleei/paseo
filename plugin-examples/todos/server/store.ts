import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import {
  TaskSchema,
  type Task,
  type TaskRun,
  type TaskRunOutcome,
  type TaskStatus,
} from "../shared/todo";

const StoredFileSchema = z.object({ version: z.literal(2), tasks: z.array(TaskSchema) });

const LegacyTodoStatusSchema = z.enum(["backlog", "planning", "building", "review", "done"]);
const LegacyTodoSchema = z.object({
  id: z.string(),
  title: z.string(),
  goal: z.string().optional(),
  status: LegacyTodoStatusSchema,
  workspaceId: z.string().nullable(),
  agentId: z.string().nullable(),
  branch: z.string().nullable().optional(),
  updatedAt: z.string(),
});
const LegacyStoredFileSchema = z.object({ todos: z.array(LegacyTodoSchema) });

function resolveHome(): string {
  const raw = process.env.PASEO_HOME ?? join(homedir(), ".paseo");
  return raw.startsWith("~/") ? join(homedir(), raw.slice(2)) : raw;
}

function taskStoreFile(): string {
  return join(resolveHome(), "plugins", "todos", "tasks.json");
}

function legacyTodoStoreFile(): string {
  return join(resolveHome(), "plugins", "todos", "todos.json");
}

let cache: Map<string, Task> | null = null;
let loadPromise: Promise<Map<string, Task>> | null = null;
let mutationQueue: Promise<void> = Promise.resolve();

function now(): string {
  return new Date().toISOString();
}

function nextId(prefix: "task" | "run"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function mapLegacyStatus(status: z.infer<typeof LegacyTodoStatusSchema>): TaskStatus {
  switch (status) {
    case "backlog":
      return "inbox";
    case "building":
      return "in_progress";
    default:
      return status;
  }
}

function migrateLegacyTodo(todo: z.infer<typeof LegacyTodoSchema>): Task {
  const status = mapLegacyStatus(todo.status);
  const hasRun = todo.workspaceId !== null && todo.agentId !== null;
  const runOutcome: TaskRunOutcome = status === "in_progress" ? "running" : "completed";
  const runs: TaskRun[] = hasRun
    ? [
        {
          id: `run_legacy_${todo.id}`,
          workspaceId: todo.workspaceId as string,
          agentId: todo.agentId as string,
          branch: todo.branch ?? null,
          startedAt: todo.updatedAt,
          finishedAt: runOutcome === "running" ? null : todo.updatedAt,
          outcome: runOutcome,
          error: null,
        },
      ]
    : [];
  return {
    id: todo.id,
    title: todo.title,
    goal: todo.goal,
    status,
    runs,
    createdAt: todo.updatedAt,
    updatedAt: todo.updatedAt,
    completedAt: status === "done" ? todo.updatedAt : null,
  };
}

export function parseStoredTasks(value: unknown): { tasks: Task[]; migrated: boolean } {
  const current = StoredFileSchema.safeParse(value);
  if (current.success) return { tasks: current.data.tasks, migrated: false };

  const legacy = LegacyStoredFileSchema.safeParse(value);
  if (legacy.success) {
    return { tasks: legacy.data.todos.map(migrateLegacyTodo), migrated: true };
  }

  throw new Error("Tasks store is invalid");
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

async function persist(tasks: Map<string, Task>): Promise<void> {
  const file = taskStoreFile();
  await mkdir(dirname(file), { recursive: true });
  await writeFile(
    `${file}.tmp`,
    JSON.stringify({ version: 2, tasks: [...tasks.values()] }, null, 2),
  );
  await rename(`${file}.tmp`, file);
}

async function loadTasks(): Promise<Map<string, Task>> {
  let parsed: { tasks: Task[]; migrated: boolean };
  try {
    parsed = parseStoredTasks(await readJson(taskStoreFile()));
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
    try {
      parsed = parseStoredTasks(await readJson(legacyTodoStoreFile()));
    } catch (legacyError) {
      if ((legacyError as NodeJS.ErrnoException)?.code === "ENOENT") return new Map();
      throw legacyError;
    }
  }

  const tasks = new Map(parsed.tasks.map((task) => [task.id, task]));
  if (parsed.migrated) await persist(tasks);
  return tasks;
}

async function ensureLoaded(): Promise<Map<string, Task>> {
  if (cache) return cache;
  loadPromise ??= loadTasks();
  try {
    cache = await loadPromise;
    return cache;
  } finally {
    loadPromise = null;
  }
}

async function mutate<T>(operation: (tasks: Map<string, Task>) => T): Promise<T> {
  const previousMutation = mutationQueue;
  let releaseMutation: () => void = () => undefined;
  mutationQueue = new Promise<void>((resolve) => {
    releaseMutation = resolve;
  });
  await previousMutation;
  try {
    const current = await ensureLoaded();
    const next = new Map(current);
    const value = operation(next);
    await persist(next);
    cache = next;
    return value;
  } finally {
    releaseMutation();
  }
}

export async function listTasks(): Promise<Task[]> {
  const tasks = await ensureLoaded();
  return [...tasks.values()].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export async function getTask(id: string): Promise<Task | undefined> {
  return (await ensureLoaded()).get(id);
}

export async function findTaskByAgentId(agentId: string): Promise<Task | undefined> {
  for (const task of (await ensureLoaded()).values()) {
    if (task.runs.some((run) => run.agentId === agentId)) return task;
  }
  return undefined;
}

export async function createTask(input: { title: string; goal?: string }): Promise<Task> {
  return mutate((tasks) => {
    const timestamp = now();
    const task: Task = {
      id: nextId("task"),
      title: input.title,
      goal: input.goal,
      status: "inbox",
      runs: [],
      createdAt: timestamp,
      updatedAt: timestamp,
      completedAt: null,
    };
    tasks.set(task.id, task);
    return task;
  });
}

export async function moveTask(id: string, status: TaskStatus): Promise<Task | undefined> {
  return mutate((tasks) => {
    const current = tasks.get(id);
    if (!current) return undefined;
    const timestamp = now();
    const next: Task = {
      ...current,
      status,
      updatedAt: timestamp,
      completedAt: status === "done" ? timestamp : null,
    };
    tasks.set(id, next);
    return next;
  });
}

export async function deleteTask(id: string): Promise<boolean> {
  return mutate((tasks) => tasks.delete(id));
}

export async function recordTaskRun(
  id: string,
  binding: { workspaceId: string; agentId: string; branch: string | null },
): Promise<Task | undefined> {
  return mutate((tasks) => {
    const current = tasks.get(id);
    if (!current) return undefined;
    const timestamp = now();
    const run: TaskRun = {
      id: nextId("run"),
      ...binding,
      startedAt: timestamp,
      finishedAt: null,
      outcome: "running",
      error: null,
    };
    const next: Task = {
      ...current,
      status: "in_progress",
      runs: [...current.runs, run],
      updatedAt: timestamp,
      completedAt: null,
    };
    tasks.set(id, next);
    return next;
  });
}

export async function markTaskRunStarted(agentId: string): Promise<Task | undefined> {
  if (!(await findTaskByAgentId(agentId))) return undefined;
  return updateTaskRun(agentId, "running", null, false, false);
}

export async function finishTaskRun(
  agentId: string,
  outcome: Exclude<TaskRunOutcome, "running">,
  error: string | null,
): Promise<Task | undefined> {
  if (!(await findTaskByAgentId(agentId))) return undefined;
  return updateTaskRun(agentId, outcome, error, true, false);
}

export async function cancelActiveTaskRun(
  agentId: string,
  error: string,
): Promise<Task | undefined> {
  if (!(await findTaskByAgentId(agentId))) return undefined;
  return updateTaskRun(agentId, "canceled", error, true, true);
}

async function updateTaskRun(
  agentId: string,
  outcome: TaskRunOutcome,
  error: string | null,
  finished: boolean,
  onlyIfRunning: boolean,
): Promise<Task | undefined> {
  return mutate((tasks) => {
    const task = [...tasks.values()].find((candidate) =>
      candidate.runs.some((run) => run.agentId === agentId),
    );
    if (!task) return undefined;
    const runIndex = task.runs.findIndex((run) => run.agentId === agentId);
    if (runIndex === -1) return undefined;
    if (onlyIfRunning && task.runs[runIndex]?.outcome !== "running") return task;
    const timestamp = now();
    const runs = [...task.runs];
    runs[runIndex] = {
      ...runs[runIndex],
      outcome,
      error,
      finishedAt: finished ? timestamp : null,
    };
    const next: Task = {
      ...task,
      status: finished ? "review" : "in_progress",
      runs,
      updatedAt: timestamp,
      completedAt: null,
    };
    tasks.set(task.id, next);
    return next;
  });
}
