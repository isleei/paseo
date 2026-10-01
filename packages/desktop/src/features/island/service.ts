/** Agent task state and actions shared with the native macOS menu bar helper. */
import { release as getOsRelease } from "node:os";

import {
  cloneAgentIslandSoundSettings,
  createDefaultAgentIslandDisplayConfig,
  DEFAULT_AGENT_ISLAND_MASCOT_SKIN,
  isAgentIslandMascotSkin,
  isAgentIslandSupportedPlatform,
  isSilentAgentIslandSoundChoice,
  normalizeAgentIslandSoundSettings,
  type AgentMenuBarState,
  type AgentIslandMascotSkin,
  type AgentIslandSoundChoice,
  type AgentIslandSoundEvent,
  type AgentIslandSoundSettings,
} from "./agent-island-shared.js";
import {
  acknowledgeAgentIslandSessionRead,
  applyAgentIslandEvent,
  applyAgentIslandInteractionDismissed,
  applyAgentIslandInteractionRequest,
  applyAgentIslandMetadata,
  closeAgentIslandSessionPreservingUnread,
  createAgentIslandState,
  buildAgentMenuBarState,
  getNextAgentIslandTimerAt,
  patchAgentIslandMetadata,
  removeAgentIslandSession,
  setAgentIslandAppFocused,
  setAgentIslandToolWording,
  setAgentIslandVisibleSession,
  type AgentIslandState,
} from "./state.js";
import { MacAgentIslandNativeHost } from "./native-host.js";
import { createIslandToolWording } from "./tool-wording.js";

/** Compact agent snapshot pushed by the renderer (owns the daemon subscription). */
export interface PaseoIslandAgentPush {
  agentId: string;
  serverId: string | null;
  title: string | null;
  projectName: string | null;
  agentKind: string;
  status: "initializing" | "idle" | "running" | "error" | "closed";
  pendingPermissions: Array<{
    requestId: string;
    toolName: string;
    input: Record<string, unknown>;
    title?: string;
    displayName?: string;
    description?: string;
  }>;
  requiresAttention: boolean;
  attentionReason: "finished" | "error" | "permission" | null;
  lastAssistantText: string | null;
  /** One-line status copy shown while running (e.g. provider label). */
  statusText: string | null;
}

export type PaseoIslandOutboundEvent =
  | {
      type: "permission-action";
      agentId: string;
      requestId: string;
      behavior: "allow" | "allowForSession" | "deny";
    }
  | { type: "focus-agent"; agentId: string }
  | { type: "open-settings" }
  | { type: "new-message" };

interface PaseoIslandServiceOptions {
  onEvent: (event: PaseoIslandOutboundEvent) => void;
}

interface TrackedPush {
  serverId: string | null;
  status: PaseoIslandAgentPush["status"];
  permissionIds: Set<string>;
  lastAssistantText: string | null;
  phase: string | null;
}

const SOUND_BY_PHASE: Record<string, AgentIslandSoundEvent> = {
  running: "start",
  "needs-interaction": "attention",
  completed: "complete",
  error: "error",
};

export class PaseoIslandService {
  private readonly state: AgentIslandState = createAgentIslandState();
  private readonly nativeHost: MacAgentIslandNativeHost;
  private readonly tracked = new Map<string, TrackedPush>();
  private readonly requestToAgent = new Map<string, string>();
  private readonly lastPhases = new Map<string, string>();
  private publishTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly permissionTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private enabled = true;
  private soundSettings: AgentIslandSoundSettings = cloneAgentIslandSoundSettings(
    createDefaultAgentIslandDisplayConfig().soundSettings,
  );
  private mascotSkin: AgentIslandMascotSkin = DEFAULT_AGENT_ISLAND_MASCOT_SKIN;

  constructor(private readonly options: PaseoIslandServiceOptions) {
    setAgentIslandToolWording(this.state, createIslandToolWording());
    this.nativeHost = new MacAgentIslandNativeHost({
      onFocusSession: (sessionId) => {
        this.options.onEvent({ type: "focus-agent", agentId: sessionId });
      },
      onDismissSession: (sessionId) => {
        // Explicit user dismissal: force-clear unread/reveal/dwell even for
        // errors, then republish so the card drops the same cycle.
        this.acknowledgeRead(sessionId);
      },
      onOpenSettings: () => this.options.onEvent({ type: "open-settings" }),
      onNewMessage: () => this.options.onEvent({ type: "new-message" }),
      onToggleSound: () => {
        this.soundSettings = { ...this.soundSettings, enabled: !this.soundSettings.enabled };
        this.publish();
      },
      onPermissionAction: ({ requestId, action }) => {
        const agentId = this.requestToAgent.get(requestId);
        if (!agentId) {
          this.nativeHost.permissionResult(
            requestId,
            "This request is no longer available. Open the task to check its status.",
          );
          return;
        }
        if (this.permissionTimers.has(requestId)) return;
        const timer = setTimeout(() => {
          this.permissionResult(
            requestId,
            "No response from the host. Open the task to check its status before retrying.",
          );
        }, 15_000);
        timer.unref();
        this.permissionTimers.set(requestId, timer);
        this.options.onEvent({
          type: "permission-action",
          agentId,
          requestId,
          behavior: action === "allowForSession" ? "allowForSession" : action,
        });
      },
    });
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  permissionResult(requestId: string, error: string | null): void {
    const timer = this.permissionTimers.get(requestId);
    if (!timer) return;
    clearTimeout(timer);
    this.permissionTimers.delete(requestId);
    this.nativeHost.permissionResult(requestId, error);
  }

  getAgentServerId(agentId: string): string | null {
    return this.tracked.get(agentId)?.serverId ?? null;
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) this.nativeHost.suspend();
    this.publish();
  }

  setMascotSkin(skin: unknown): boolean {
    if (!isAgentIslandMascotSkin(skin) || this.mascotSkin === skin) return false;
    this.mascotSkin = skin;
    this.publish();
    return true;
  }

  getMascotSkin(): AgentIslandMascotSkin {
    return this.mascotSkin;
  }

  setSoundSettings(settings: unknown): void {
    this.soundSettings = normalizeAgentIslandSoundSettings(settings);
    this.publish();
  }

  getSoundSettings(): AgentIslandSoundSettings {
    return cloneAgentIslandSoundSettings(this.soundSettings);
  }

  setVisibleSession(sessionId: string | readonly string[] | null): void {
    if (setAgentIslandVisibleSession(this.state, sessionId)) this.publish();
  }

  setAppFocused(focused: boolean): void {
    if (setAgentIslandAppFocused(this.state, focused)) this.publish();
  }

  /** Publish the menu bar entry even before the first task arrives. */
  refresh(): void {
    this.publish();
  }

  acknowledgeRead(agentId: string): void {
    if (acknowledgeAgentIslandSessionRead(this.state, agentId, Date.now()) !== "noop") {
      this.publish();
    }
  }

  removeAgent(agentId: string): void {
    removeAgentIslandSession(this.state, agentId);
    this.tracked.delete(agentId);
    this.publish();
  }

  /**
   * Reconcile renderer-pushed agent snapshots into island state.
   * The renderer is the source of truth; unknown agentIds are closed
   * (preserving unread terminals like Cindy's session-close path).
   */
  pushAgents(list: PaseoIslandAgentPush[]): void {
    const now = Date.now();
    const seen = new Set<string>();
    let changed = false;
    for (const agent of list) {
      if (!agent.agentId) continue;
      seen.add(agent.agentId);
      changed = this.reconcileAgent(agent, now) || changed;
    }
    for (const trackedId of this.tracked.keys()) {
      if (seen.has(trackedId)) continue;
      this.tracked.delete(trackedId);
      for (const [requestId, agentId] of this.requestToAgent.entries()) {
        if (agentId === trackedId) this.requestToAgent.delete(requestId);
      }
      closeAgentIslandSessionPreservingUnread(this.state, trackedId, now);
      changed = true;
    }
    if (changed) this.publish();
  }

  shutdown(): void {
    if (this.publishTimer) clearTimeout(this.publishTimer);
    this.publishTimer = null;
    for (const timer of this.permissionTimers.values()) clearTimeout(timer);
    this.permissionTimers.clear();
    this.nativeHost.stop();
  }

  private reconcileAgent(agent: PaseoIslandAgentPush, now: number): boolean {
    let changed = false;
    const meta = {
      sessionId: agent.agentId,
      agentKind: agent.agentKind,
      title: agent.title,
      workspaceKind: agent.projectName,
    };
    const previous = this.tracked.get(agent.agentId);
    if (!previous) {
      applyAgentIslandMetadata(this.state, meta, now);
      changed = true;
    } else if (patchAgentIslandMetadata(this.state, meta)) {
      changed = true;
    }

    if (
      agent.lastAssistantText &&
      agent.lastAssistantText !== previous?.lastAssistantText &&
      applyAgentIslandEvent(
        this.state,
        meta,
        { type: "text", data: { text: agent.lastAssistantText } },
        now,
      )
    ) {
      changed = true;
    }

    if (agent.status === "running") {
      if (
        applyAgentIslandEvent(
          this.state,
          meta,
          { type: "status", data: { isRunning: true, status: agent.statusText } },
          now,
        )
      ) {
        changed = true;
      }
    }

    const nextPermissionIds = new Set(agent.pendingPermissions.map((p) => p.requestId));
    changed = this.syncPermissions(agent, meta, previous, nextPermissionIds, now) || changed;
    changed = this.syncTerminalTransition(agent, meta, previous, now) || changed;

    const entry: TrackedPush = {
      serverId: agent.serverId,
      status: agent.status,
      permissionIds: nextPermissionIds,
      lastAssistantText: agent.lastAssistantText,
      phase: previous?.phase ?? null,
    };
    this.tracked.set(agent.agentId, entry);
    return changed;
  }

  private syncPermissions(
    agent: PaseoIslandAgentPush,
    meta: {
      sessionId: string;
      agentKind: string;
      title: string | null;
      workspaceKind: string | null;
    },
    previous: TrackedPush | undefined,
    nextPermissionIds: Set<string>,
    now: number,
  ): boolean {
    let changed = false;
    for (const perm of agent.pendingPermissions) {
      if (previous?.permissionIds.has(perm.requestId)) continue;
      applyAgentIslandInteractionRequest(
        this.state,
        meta,
        {
          kind: "permission",
          requestId: perm.requestId,
          toolName: perm.toolName,
          input: perm.input,
          title: perm.title,
          displayName: perm.displayName,
          description: perm.description,
        },
        now,
      );
      this.requestToAgent.set(perm.requestId, agent.agentId);
      changed = true;
    }
    for (const oldId of previous?.permissionIds ?? []) {
      if (nextPermissionIds.has(oldId)) continue;
      applyAgentIslandInteractionDismissed(this.state, agent.agentId, oldId, now);
      this.requestToAgent.delete(oldId);
      changed = true;
    }
    return changed;
  }

  private syncTerminalTransition(
    agent: PaseoIslandAgentPush,
    meta: {
      sessionId: string;
      agentKind: string;
      title: string | null;
      workspaceKind: string | null;
    },
    previous: TrackedPush | undefined,
    now: number,
  ): boolean {
    const prevStatus = previous?.status;
    if (agent.status === "error" && prevStatus !== "error") {
      return applyAgentIslandEvent(
        this.state,
        meta,
        { type: "error", data: { message: agent.title ?? "Agent failed", isTerminal: true } },
        now,
      );
    }
    if (this.isFreshCompletion(agent, prevStatus)) {
      return applyAgentIslandEvent(this.state, meta, { type: "done", data: {} }, now);
    }
    if (
      agent.status === "idle" &&
      (prevStatus === "running" || prevStatus === "initializing") &&
      agent.requiresAttention &&
      agent.attentionReason === "error"
    ) {
      return applyAgentIslandEvent(
        this.state,
        meta,
        { type: "error", data: { message: agent.title ?? "Agent failed", isTerminal: true } },
        now,
      );
    }
    if (agent.status === "idle" && prevStatus !== "idle" && !agent.requiresAttention) {
      // Quiet finish: settle the session without raising unread, so routine
      // completions don't badge the island for hours. Attention finishes and
      // errors above still notify.
      return applyAgentIslandEvent(
        this.state,
        meta,
        { type: "status", data: { isRunning: false, status: "Done" } },
        now,
        { suppressCompletionAttention: true },
      );
    }
    return false;
  }

  private isFreshCompletion(
    agent: PaseoIslandAgentPush,
    prevStatus: PaseoIslandAgentPush["status"] | undefined,
  ): boolean {
    return (
      agent.status === "idle" &&
      (prevStatus === "running" || prevStatus === "initializing") &&
      agent.requiresAttention &&
      agent.attentionReason === "finished"
    );
  }

  private playSoundChoice(choice: AgentIslandSoundChoice): void {
    if (!this.soundSettings.enabled || isSilentAgentIslandSoundChoice(choice)) return;
    this.nativeHost.playSound(choice);
  }

  private publish(): void {
    if (this.publishTimer) {
      clearTimeout(this.publishTimer);
      this.publishTimer = null;
    }
    const now = Date.now();
    if (!this.enabled || !isAgentIslandSupportedPlatform(process.platform, getOsRelease())) {
      this.nativeHost.suspend();
      return;
    }
    const displayState = this.decorateDisplayState(buildAgentMenuBarState(this.state, now));
    this.playTransitionSounds(displayState);
    this.nativeHost.publish(displayState);
    const nextAt = getNextAgentIslandTimerAt(this.state, Date.now());
    if (nextAt !== null) {
      const delay = Math.max(0, nextAt - Date.now());
      this.publishTimer = setTimeout(() => {
        this.publishTimer = null;
        this.publish();
      }, delay);
      this.publishTimer.unref?.();
    }
  }

  /** Edge-trigger sounds on phase transitions (new sessions count as entered). */
  private playTransitionSounds(displayState: AgentMenuBarState): void {
    const seen = new Set<string>();
    for (const session of displayState.sessions) {
      seen.add(session.sessionId);
      const previous = this.lastPhases.get(session.sessionId);
      if (previous !== session.phase) {
        const event = SOUND_BY_PHASE[session.phase];
        if (event) this.playSoundChoice(this.soundSettings.sounds[event]);
      }
      this.lastPhases.set(session.sessionId, session.phase);
    }
    for (const sessionId of this.lastPhases.keys()) {
      if (!seen.has(sessionId)) this.lastPhases.delete(sessionId);
    }
  }

  private decorateDisplayState(displayState: AgentMenuBarState): AgentMenuBarState {
    return {
      ...displayState,
      soundSettings: cloneAgentIslandSoundSettings(this.soundSettings),
      mascotSkin: this.mascotSkin,
    };
  }
}
