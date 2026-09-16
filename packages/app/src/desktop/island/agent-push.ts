import type { DesktopIslandAgentPush } from "@/desktop/host";
import type { Agent } from "@/stores/session-store";

const MAX_PUSH_AGENTS = 50;

export interface IslandAgentDirectory {
  serverId: string;
  agents: ReadonlyMap<string, Agent>;
  agentDetails: ReadonlyMap<string, Agent>;
}

function providerLabel(provider: string): string {
  switch (provider) {
    case "claude-code":
      return "Claude";
    case "codex":
      return "Codex";
    case "copilot":
      return "Copilot";
    case "opencode":
      return "OpenCode";
    case "pi":
      return "Pi";
    default:
      return provider || "Agent";
  }
}

function islandStatus(agent: Agent): Agent["status"] {
  if (agent.turn.phase === "open") return "running";
  return agent.status === "running" ? "idle" : agent.status;
}

function priority(agent: Agent): number {
  const status = islandStatus(agent);
  if (agent.pendingPermissions.length > 0 || agent.requiresAttention || status === "error")
    return 0;
  if (status === "running" || status === "initializing") return 1;
  return 2;
}

function compareAgents(left: Agent, right: Agent): number {
  const priorityDelta = priority(left) - priority(right);
  if (priorityDelta !== 0) return priorityDelta;
  return right.lastActivityAt.getTime() - left.lastActivityAt.getTime();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function buildIslandAgentPushList(
  directories: readonly IslandAgentDirectory[],
): DesktopIslandAgentPush[] {
  const agents = directories.flatMap(({ serverId, agents: directoryAgents, agentDetails }) => {
    const combined = new Map(directoryAgents);
    for (const [agentId, agent] of agentDetails) combined.set(agentId, agent);
    return Array.from(combined.values())
      .filter((agent) => !agent.archivedAt && islandStatus(agent) !== "closed")
      .map((agent) => ({ serverId, agent }));
  });
  agents.sort((left, right) => compareAgents(left.agent, right.agent));

  return agents.slice(0, MAX_PUSH_AGENTS).map(({ serverId, agent }) => {
    const status = islandStatus(agent);
    return {
      agentId: agent.id,
      serverId,
      title: agent.title,
      projectName: agent.projectPlacement?.projectName ?? null,
      agentKind: agent.provider,
      status,
      pendingPermissions: agent.pendingPermissions.map((request) => ({
        requestId: request.id,
        toolName: request.name,
        input: isRecord(request.input) ? request.input : {},
        ...(request.title ? { title: request.title } : {}),
        ...(request.description ? { description: request.description } : {}),
      })),
      requiresAttention: agent.requiresAttention ?? false,
      attentionReason: agent.attentionReason ?? null,
      lastAssistantText: null,
      statusText: status === "running" ? `${providerLabel(agent.provider)} · Running` : null,
    };
  });
}
