import type { TaskStatus } from "./todo";

export const TASKS_LOCALES = ["en", "zh-CN"] as const;
export type TasksLocale = (typeof TASKS_LOCALES)[number];

export type AgentLiveStatus = "initializing" | "idle" | "running" | "error" | "closed" | "unknown";
export type AgentAttentionReason = "finished" | "error" | "permission";

export interface TasksStrings {
  boardTitle: string;
  boardSubtitle: string;
  titlePlaceholder: string;
  goalPlaceholder: string;
  cwdPlaceholder: string;
  create: string;
  creating: string;
  run: string;
  runAgain: string;
  starting: string;
  openAgent: string;
  plan: string;
  unassigned: string;
  empty: string;
  agentLabel: string;
  thisWorkspace: string;
  nothingHere: string;
  inboxSection: string;
  switchLanguageLabel: string;
  deleteAction: string;
  moveAction: string;
  agentGone: string;
  runAs: string;
  runSetupRequired: string;
  executionCount: string;
  selectModel: string;
  backToProviders: string;
  providerLabel: string;
  modelLabel: string;
  loadingCatalog: string;
  noProviders: string;
  noModels: string;
  agentStateName: Record<AgentLiveStatus, string>;
  attentionName: Record<AgentAttentionReason, string>;
  statusName: Record<TaskStatus, string>;
}

const en: TasksStrings = {
  boardTitle: "Tasks",
  boardSubtitle: "Keep work independent from agent sessions. Each run gets its own workspace.",
  titlePlaceholder: "New task title",
  goalPlaceholder: "Goal / prompt for the agent (optional)",
  cwdPlaceholder: "/absolute/checkout/path for execution",
  create: "Create task",
  creating: "Creating…",
  run: "Run task",
  runAgain: "Run again",
  starting: "Starting…",
  openAgent: "Open agent",
  plan: "Plan",
  unassigned: "No execution yet",
  empty: "Empty",
  agentLabel: "agent",
  thisWorkspace: "Tasks in this workspace",
  nothingHere: "No task has run here yet.",
  inboxSection: "Inbox",
  switchLanguageLabel: "中文",
  deleteAction: "Delete",
  moveAction: "Move to",
  agentGone: "agent removed",
  runAs: "Run with",
  runSetupRequired: "Choose a checkout path, provider, and model before running a task.",
  executionCount: "executions",
  selectModel: "Select model",
  backToProviders: "Providers",
  providerLabel: "Provider",
  modelLabel: "Model",
  loadingCatalog: "Loading providers…",
  noProviders: "No available providers",
  noModels: "No models for this provider",
  agentStateName: {
    initializing: "starting",
    idle: "idle",
    running: "running",
    error: "error",
    closed: "closed",
    unknown: "unknown",
  },
  attentionName: {
    finished: "Finished, needs review",
    error: "Failed, needs review",
    permission: "Permission needed",
  },
  statusName: {
    inbox: "inbox",
    planning: "planning",
    in_progress: "in progress",
    review: "review",
    done: "done",
  },
};

const zhCN: TasksStrings = {
  boardTitle: "任务",
  boardSubtitle: "任务独立于智能体会话；每次执行都会创建独立工作区。",
  titlePlaceholder: "新任务标题",
  goalPlaceholder: "给智能体的目标 / 提示（可选）",
  cwdPlaceholder: "执行使用的 checkout 绝对路径",
  create: "创建任务",
  creating: "创建中…",
  run: "执行任务",
  runAgain: "再次执行",
  starting: "启动中…",
  openAgent: "打开智能体",
  plan: "规划",
  unassigned: "尚未执行",
  empty: "空",
  agentLabel: "智能体",
  thisWorkspace: "此工作区的任务",
  nothingHere: "还没有任务在这里执行。",
  inboxSection: "收件箱",
  switchLanguageLabel: "EN",
  deleteAction: "删除",
  moveAction: "移到",
  agentGone: "智能体已移除",
  runAs: "执行设置",
  runSetupRequired: "执行任务前请选择 checkout 路径、提供方和模型。",
  executionCount: "次执行",
  selectModel: "选择模型",
  backToProviders: "提供方",
  providerLabel: "提供方",
  modelLabel: "模型",
  loadingCatalog: "加载提供方…",
  noProviders: "无可用提供方",
  noModels: "该提供方暂无模型",
  agentStateName: {
    initializing: "启动中",
    idle: "空闲",
    running: "运行中",
    error: "出错",
    closed: "已关闭",
    unknown: "未知",
  },
  attentionName: {
    finished: "已完成，待确认",
    error: "出错，待确认",
    permission: "需要授权",
  },
  statusName: {
    inbox: "收件箱",
    planning: "规划中",
    in_progress: "执行中",
    review: "待评审",
    done: "已完成",
  },
};

export const STRINGS: Record<TasksLocale, TasksStrings> = { en, "zh-CN": zhCN };

export function pickLocale(language: string | null | undefined): TasksLocale {
  if (language && language.replace("_", "-").toLowerCase().startsWith("zh")) return "zh-CN";
  return "en";
}
