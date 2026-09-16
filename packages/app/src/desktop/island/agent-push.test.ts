import { describe, expect, it } from "vitest";
import type { Agent } from "@/stores/session-store";
import { buildIslandAgentPushList } from "./agent-push";

const TIMESTAMP = new Date("2026-09-16T10:00:00.000Z");

const AGENT_DEFAULTS: Agent = {
  serverId: "server-1",
  id: "agent",
  provider: "codex",
  status: "idle",
  turn: { phase: "idle", cancellationRequestId: null },
  createdAt: TIMESTAMP,
  updatedAt: TIMESTAMP,
  lastUserMessageAt: null,
  lastActivityAt: TIMESTAMP,
  capabilities: {
    supportsStreaming: true,
    supportsSessionPersistence: true,
    supportsDynamicModes: true,
    supportsMcpServers: true,
    supportsReasoningStream: true,
    supportsToolInvocations: true,
  },
  currentModeId: null,
  availableModes: [],
  pendingPermissions: [],
  persistence: null,
  runtimeInfo: undefined,
  lastUsage: undefined,
  lastError: null,
  title: "Agent",
  cwd: "/repo",
  model: null,
  features: undefined,
  thinkingOptionId: undefined,
  requiresAttention: false,
  attentionReason: null,
  attentionTimestamp: null,
  archivedAt: null,
  parentAgentId: null,
  labels: {},
  projectPlacement: null,
};

function makeAgent(input: Partial<Agent> & Pick<Agent, "id">): Agent {
  return { ...AGENT_DEFAULTS, ...input };
}

describe("buildIslandAgentPushList", () => {
  it("keeps a running task when inactive records exceed the push limit", () => {
    const inactiveAgents = Array.from({ length: 50 }, (_, index) =>
      makeAgent({ id: `idle-${index}` }),
    );
    const runningAgent = makeAgent({
      id: "running-agent",
      status: "running",
      turn: { phase: "open", turnId: "turn-1", startedAt: TIMESTAMP, cancellationRequestId: null },
    });
    const agents = new Map([...inactiveAgents, runningAgent].map((agent) => [agent.id, agent]));

    const list = buildIslandAgentPushList([
      { serverId: "server-1", agents, agentDetails: new Map() },
    ]);

    expect(list).toHaveLength(50);
    expect(list[0]).toMatchObject({ agentId: "running-agent", status: "running" });
  });

  it("excludes closed and archived tasks from the island directory", () => {
    const agents = new Map(
      [
        makeAgent({ id: "active-idle" }),
        makeAgent({ id: "closed-agent", status: "closed" }),
        makeAgent({ id: "archived-agent", archivedAt: TIMESTAMP }),
      ].map((agent) => [agent.id, agent]),
    );

    const list = buildIslandAgentPushList([
      { serverId: "server-1", agents, agentDetails: new Map() },
    ]);

    expect(list.map((agent) => agent.agentId)).toEqual(["active-idle"]);
  });

  it("includes an open task while its directory entry is still hydrating", () => {
    const runningAgent = makeAgent({
      id: "open-detail",
      status: "idle",
      turn: { phase: "open", turnId: "turn-2", startedAt: TIMESTAMP, cancellationRequestId: null },
    });

    const list = buildIslandAgentPushList([
      {
        serverId: "server-1",
        agents: new Map(),
        agentDetails: new Map([[runningAgent.id, runningAgent]]),
      },
    ]);

    expect(list).toEqual([expect.objectContaining({ agentId: "open-detail", status: "running" })]);
  });
});
