import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";

export interface SessionActivityTarget {
  agent: AggregatedAgent;
  kind: "attention" | "running";
}

const ATTENTION_PRIORITY = {
  permission: 0,
  error: 1,
  finished: 2,
} as const;

function attentionPriority(agent: AggregatedAgent): number | null {
  if ((agent.pendingPermissionCount ?? 0) > 0) return ATTENTION_PRIORITY.permission;
  if (!agent.requiresAttention || !agent.attentionReason) return null;
  return ATTENTION_PRIORITY[agent.attentionReason];
}

function attentionTime(agent: AggregatedAgent): number {
  return (agent.attentionTimestamp ?? agent.lastActivityAt).getTime();
}

export function pickSessionActivityTarget(
  agents: readonly AggregatedAgent[],
): SessionActivityTarget | null {
  let attentionAgent: AggregatedAgent | null = null;
  let attentionAgentPriority = Number.POSITIVE_INFINITY;

  for (const agent of agents) {
    if (agent.archivedAt) continue;
    const priority = attentionPriority(agent);
    if (priority === null) continue;
    const isHigherPriority = priority < attentionAgentPriority;
    const isNewerAtSamePriority =
      priority === attentionAgentPriority &&
      (!attentionAgent || attentionTime(agent) > attentionTime(attentionAgent));
    if (isHigherPriority || isNewerAtSamePriority) {
      attentionAgent = agent;
      attentionAgentPriority = priority;
    }
  }

  if (attentionAgent) return { agent: attentionAgent, kind: "attention" };

  let runningAgent: AggregatedAgent | null = null;
  for (const agent of agents) {
    if (agent.archivedAt || (agent.status !== "running" && agent.status !== "initializing")) {
      continue;
    }
    if (!runningAgent || agent.lastActivityAt > runningAgent.lastActivityAt) {
      runningAgent = agent;
    }
  }

  return runningAgent ? { agent: runningAgent, kind: "running" } : null;
}
