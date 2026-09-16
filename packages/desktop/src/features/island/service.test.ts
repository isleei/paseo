import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    isPackaged: false,
    getPath: (name: string) => (name === "userData" ? "/tmp/paseo-island-test" : "/tmp"),
    getAppPath: () => "/tmp/paseo-island-test-app",
  },
  screen: {
    getAllDisplays: () => [{ id: 1, bounds: { x: 0, y: 0, width: 1512, height: 944 } }],
    getPrimaryDisplay: () => ({ id: 1, bounds: { x: 0, y: 0, width: 1512, height: 944 } }),
    on: vi.fn(),
  },
}));

vi.mock("electron-log/main", () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

const published: Array<{ state: TestDisplayState; frame: unknown }> = [];
let hostOptions: TestHostOptions | null = null;

vi.mock("./native-host.js", () => ({
  MacAgentIslandNativeHost: class {
    constructor(options: TestHostOptions) {
      hostOptions = options;
    }

    publish(state: TestDisplayState, frame: unknown) {
      published.push({ state, frame });
      return true;
    }

    playSound() {
      return true;
    }

    suspend() {}

    stop() {}
  },
}));

interface TestDisplayState {
  sessions: Array<{
    sessionId: string;
    phase: string;
    title: string;
    permissionAction: { requestId: string } | null;
  }>;
  pillSnapshot: { activeSessionCount: number; sessionCount: number };
  mascotSkin: string;
}

interface TestHostOptions {
  onPermissionAction: (action: { requestId: string; action: string }) => void;
  onFocusSession: (sessionId: string) => void;
  [key: string]: unknown;
}

import { PaseoIslandService } from "./service.js";

function makeService() {
  published.length = 0;
  hostOptions = null;
  const events: unknown[] = [];
  const service = new PaseoIslandService({
    onEvent: (event) => {
      events.push(event);
    },
  });
  return { service, events };
}

describe("PaseoIslandService", () => {
  beforeEach(() => {
    published.length = 0;
    hostOptions = null;
    vi.clearAllMocks();
  });

  it("publishes a running session with the paimon mascot by default", () => {
    const { service } = makeService();
    service.pushAgents([
      {
        agentId: "a1",
        serverId: "s1",
        title: "hello",
        projectName: "paseo",
        agentKind: "opencode",
        status: "running",
        pendingPermissions: [],
        requiresAttention: false,
        attentionReason: null,
        lastAssistantText: null,
        statusText: "OpenCode · Running",
      },
    ]);
    expect(published.length).toBeGreaterThan(0);
    const latest = published[published.length - 1]?.state;
    expect(latest?.mascotSkin).toBe("paimon");
    expect(latest?.sessions).toHaveLength(1);
    expect(latest?.sessions[0]).toMatchObject({ sessionId: "a1", phase: "running" });
    expect(latest?.pillSnapshot.activeSessionCount).toBe(1);
    service.shutdown();
  });

  it("transitions running to completed with attention on finish", () => {
    const { service } = makeService();
    const running = {
      agentId: "a1",
      serverId: "s1",
      title: "hello",
      projectName: null,
      agentKind: "opencode",
      status: "running" as const,
      pendingPermissions: [],
      requiresAttention: false,
      attentionReason: null,
      lastAssistantText: null,
      statusText: null,
    };
    service.pushAgents([running]);
    service.pushAgents([
      { ...running, status: "idle", requiresAttention: true, attentionReason: "finished" },
    ]);
    const latest = published[published.length - 1]?.state;
    expect(latest?.sessions[0]).toMatchObject({ sessionId: "a1", phase: "completed" });
    service.shutdown();
  });

  it("raises needs-interaction with a permission action and routes allow back", () => {
    const { service, events } = makeService();
    service.pushAgents([
      {
        agentId: "a1",
        serverId: "s1",
        title: "hello",
        projectName: null,
        agentKind: "opencode",
        status: "running",
        pendingPermissions: [{ requestId: "r1", toolName: "Bash", input: { command: "ls" } }],
        requiresAttention: false,
        attentionReason: null,
        lastAssistantText: null,
        statusText: null,
      },
    ]);
    const latest = published[published.length - 1]?.state;
    expect(latest?.sessions[0]).toMatchObject({
      sessionId: "a1",
      phase: "needs-interaction",
    });
    expect(latest?.sessions[0]?.permissionAction).toMatchObject({ requestId: "r1" });

    hostOptions?.onPermissionAction({ requestId: "r1", action: "allow" });
    expect(events).toContainEqual({
      type: "permission-action",
      agentId: "a1",
      requestId: "r1",
      behavior: "allow",
    });
    service.shutdown();
  });

  it("forwards focus-session as a focus-agent event", () => {
    const { service, events } = makeService();
    hostOptions?.onFocusSession("a9");
    expect(events).toContainEqual({ type: "focus-agent", agentId: "a9" });
    expect(service.getAgentServerId("a9")).toBeNull();
    service.shutdown();
  });
});
