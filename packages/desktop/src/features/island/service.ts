/**
 * Paseo Agent Island service (main process).
 *
 * Port of Cindy's `main/agent-island/service.ts` display core, adapted to
 * Paseo's data model: the renderer (which owns the daemon `observeAgents`
 * subscription) pushes compact agent snapshots via `pushAgents()`; this
 * service feeds them into the ported island state reducer and publishes
 * display frames to the native Swift helper. Reverse interactions
 * (permission allow/deny, focus agent) are forwarded to the renderer, which
 * owns the DaemonClient.
 */
import { screen, type Display } from "electron";
import { release as getOsRelease } from "node:os";
import log from "electron-log/main";

import {
  AGENT_ISLAND_MAX_EXPANDED_HEIGHT,
  AGENT_ISLAND_MAX_EXPANDED_WIDTH,
  cloneAgentIslandDisplayTarget,
  cloneAgentIslandSoundSettings,
  computeAgentIslandContentHeight,
  createDefaultAgentIslandDisplayConfig,
  DEFAULT_AGENT_ISLAND_DISPLAY_TARGET,
  DEFAULT_AGENT_ISLAND_MASCOT_SKIN,
  getAgentIslandDefaultContentWidth,
  getAgentIslandMinimumContentWidth,
  isAgentIslandMascotSkin,
  isAgentIslandSupportedPlatform,
  isSilentAgentIslandSoundChoice,
  normalizeAgentIslandDisplayTarget,
  normalizeAgentIslandSoundSettings,
  snapAgentIslandCompactHardwareContentWidth,
  type AgentIslandDisplayState,
  type AgentIslandDisplayTarget,
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
  buildAgentIslandDisplayState,
  closeAgentIslandSessionPreservingUnread,
  createAgentIslandState,
  dismissAgentIslandActiveReveal,
  getNextAgentIslandTimerAt,
  patchAgentIslandMetadata,
  removeAgentIslandSession,
  requestAgentIslandManualCollapse,
  requestAgentIslandManualExpand,
  setAgentIslandAppFocused,
  setAgentIslandLayoutDragActive,
  setAgentIslandMeasuredContentHeight,
  setAgentIslandPointerZones,
  setAgentIslandToolWording,
  setAgentIslandVisibleSession,
  type AgentIslandState,
} from "./state.js";
import { computeAgentIslandCarrierSize, computeAgentIslandWindowBounds } from "./geometry.js";
import {
  readAgentIslandLayoutPreferences,
  writeAgentIslandLayoutPreference,
} from "./layout-preference-store.js";
import { MacAgentIslandNativeHost, type AgentIslandNativeFrame } from "./native-host.js";
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
  private layoutSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private enabled = true;
  private soundSettings: AgentIslandSoundSettings = cloneAgentIslandSoundSettings(
    createDefaultAgentIslandDisplayConfig().soundSettings,
  );
  private mascotSkin: AgentIslandMascotSkin = DEFAULT_AGENT_ISLAND_MASCOT_SKIN;
  private displayTarget: AgentIslandDisplayTarget = cloneAgentIslandDisplayTarget(
    DEFAULT_AGENT_ISLAND_DISPLAY_TARGET,
  );

  constructor(private readonly options: PaseoIslandServiceOptions) {
    setAgentIslandToolWording(this.state, createIslandToolWording());
    this.nativeHost = new MacAgentIslandNativeHost({
      onPointerZones: (zones) => {
        if (setAgentIslandPointerZones(this.state, zones, Date.now())) this.publish();
      },
      onExpand: (displayId) => {
        if (requestAgentIslandManualExpand(this.state, displayId)) {
          this.playSoundChoice(this.soundSettings.sounds.select);
          this.publish();
        }
      },
      onCollapse: (displayId) => {
        void displayId;
        if (requestAgentIslandManualCollapse(this.state, Date.now())) this.publish();
      },
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
        if (!agentId) return;
        this.options.onEvent({
          type: "permission-action",
          agentId,
          requestId,
          behavior: action === "allowForSession" ? "allowForSession" : action,
        });
      },
      onOutsideClick: () => {
        if (dismissAgentIslandActiveReveal(this.state, Date.now())) this.publish();
      },
      onLayoutDragActive: (active) => {
        setAgentIslandLayoutDragActive(this.state, active);
      },
      onLayoutPreference: (preference) => {
        if (typeof preference.displayId === "number") {
          this.scheduleLayoutSave(preference.displayId, preference);
        }
        this.publish();
      },
      onContentHeight: (height) => {
        if (setAgentIslandMeasuredContentHeight(this.state, height)) this.publish();
      },
      onScreenMetrics: () => {
        this.publish();
      },
    });
  }

  get isEnabled(): boolean {
    return this.enabled;
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

  setDisplayTarget(target: unknown): void {
    this.displayTarget = normalizeAgentIslandDisplayTarget(target);
    this.publish();
  }

  setVisibleSession(sessionId: string | readonly string[] | null): void {
    if (setAgentIslandVisibleSession(this.state, sessionId)) this.publish();
  }

  setAppFocused(focused: boolean): void {
    if (setAgentIslandAppFocused(this.state, focused)) this.publish();
  }

  /** Recompute the frame (display list changed, window moved across screens). */
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
    if (this.layoutSaveTimer) clearTimeout(this.layoutSaveTimer);
    this.layoutSaveTimer = null;
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

  private scheduleLayoutSave(
    displayId: number,
    preference: Parameters<typeof writeAgentIslandLayoutPreference>[1],
  ): void {
    if (this.layoutSaveTimer) clearTimeout(this.layoutSaveTimer);
    this.layoutSaveTimer = setTimeout(() => {
      this.layoutSaveTimer = null;
      try {
        writeAgentIslandLayoutPreference(displayId, preference);
      } catch (error) {
        log.warn("[agent-island] failed to persist layout preference", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }, 150);
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
    const displayState = this.decorateDisplayState(buildAgentIslandDisplayState(this.state, now));
    this.playTransitionSounds(displayState);
    const displays = this.getTargetDisplays();
    if (displays.length === 0) {
      this.nativeHost.suspend();
      return;
    }
    const statesByDisplayId = this.computeStatesByDisplayId(displayState, displays);
    const frames = displays.map((display) => {
      const stateForDisplay =
        (statesByDisplayId?.[String(display.id)] as AgentIslandDisplayState | undefined) ??
        displayState;
      return this.computeFrame(stateForDisplay, display);
    });
    this.nativeHost.publish(displayState, frames, statesByDisplayId);
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
  private playTransitionSounds(displayState: AgentIslandDisplayState): void {
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

  private decorateDisplayState(displayState: AgentIslandDisplayState): AgentIslandDisplayState {
    return {
      ...displayState,
      soundSettings: cloneAgentIslandSoundSettings(this.soundSettings),
      mascotSkin: this.mascotSkin,
    };
  }

  private computeFrame(
    displayState: AgentIslandDisplayState,
    target: Display,
  ): AgentIslandNativeFrame {
    const expanded = displayState.mode === "expanded";
    const hasSession = displayState.sessions.length > 0;
    const preferences = readAgentIslandLayoutPreferences();
    const preference = preferences.get(target.id);
    const defaultContentWidth = getAgentIslandDefaultContentWidth({
      expanded,
      hasSession,
      displayWidth: target.bounds.width,
      screenMetrics: null,
      pillSnapshot: displayState.pillSnapshot,
    });
    const minimumContentWidth = getAgentIslandMinimumContentWidth({
      expanded,
      screenMetrics: null,
    });
    const contentHeight = computeAgentIslandContentHeight({
      mode: displayState.mode,
      displaySurface: displayState.displaySurface,
      hasSession,
      totalCount: displayState.totalCount,
      measuredContentHeight: displayState.measuredContentHeight,
    });
    const preferredWidth =
      (expanded ? preference?.expandedContentWidth : preference?.compactContentWidth) ??
      defaultContentWidth;
    const maxWidth = Math.min(AGENT_ISLAND_MAX_EXPANDED_WIDTH, Math.max(0, target.bounds.width));
    const clamped = Math.min(maxWidth, Math.max(minimumContentWidth, preferredWidth));
    const snapped = expanded
      ? clamped
      : snapAgentIslandCompactHardwareContentWidth({
          desiredWidth: preferredWidth,
          clampedWidth: clamped,
          maxWidth,
          hasSession,
          screenMetrics: null,
          pillSnapshot: displayState.pillSnapshot,
        });
    const carrier = computeAgentIslandCarrierSize(
      { bounds: target.bounds },
      expanded,
      Math.min(contentHeight, AGENT_ISLAND_MAX_EXPANDED_HEIGHT),
      snapped,
      defaultContentWidth,
      minimumContentWidth,
    );
    const bounds = computeAgentIslandWindowBounds(
      { bounds: target.bounds },
      {
        expanded,
        contentHeight: carrier.height,
        centerXRatio: preference?.centerXRatio ?? 0.5,
        contentWidth: carrier.contentWidth,
        defaultContentWidth,
        minimumContentWidth,
      },
    );
    return {
      x: Math.round(bounds.x),
      y: Math.round(target.bounds.y),
      width: Math.round(bounds.width),
      height: Math.round(bounds.height),
      displayId: target.id,
      displayBounds: { ...target.bounds },
      contentWidth: carrier.contentWidth,
    };
  }

  private getAvailableDisplays(): Display[] {
    const displays = screen.getAllDisplays();
    return displays.length > 0 ? displays : [screen.getPrimaryDisplay()];
  }

  private getTargetDisplays(displays: Display[] = this.getAvailableDisplays()): Display[] {
    const selected = this.displayTarget;
    if (selected.mode === "display") {
      const match = displays.find((d) => d.id === selected.displayId);
      // A temporary disconnect renders on primary; the saved identity is kept
      // so reconnecting restores the user's choice.
      return [match ?? screen.getPrimaryDisplay()];
    }
    return displays;
  }

  /**
   * Per-display states for manual expand: the expanded card stays on the
   * display it was opened on, every other display falls back to compact.
   */
  private computeStatesByDisplayId(
    displayState: AgentIslandDisplayState,
    displays: Display[],
  ): Record<string, AgentIslandDisplayState> | undefined {
    if (
      displayState.mode !== "expanded" ||
      displayState.displayPolicy !== "manualExpanded" ||
      typeof displayState.expandedDisplayId !== "number" ||
      displays.length <= 1
    ) {
      return undefined;
    }
    if (!displays.some((display) => display.id === displayState.expandedDisplayId)) {
      return undefined;
    }
    return Object.fromEntries(
      displays.map((display) => [
        String(display.id),
        display.id === displayState.expandedDisplayId
          ? displayState
          : collapseManualExpandedStateForInactiveDisplay(displayState),
      ]),
    );
  }
}

function collapseManualExpandedStateForInactiveDisplay(
  displayState: AgentIslandDisplayState,
): AgentIslandDisplayState {
  return {
    ...displayState,
    mode: "compact",
    notchStatus: displayState.currentSessionId ? "peek" : "closed",
    displayPolicy: displayState.currentSessionId ? "peek" : "closed",
    displaySurface: "collapsed",
    layoutMode: "compact",
    shadowVisible: false,
    expandedDisplayId: null,
  };
}
