/**
 * IPC wiring for the Paseo Agent Island (main process side).
 *
 * Renderer (which owns the daemon subscription) pushes agent snapshots;
 * island interactions flow back as renderer events so the DaemonClient owner
 * can resolve permissions / navigate.
 */
import { app, BrowserWindow, ipcMain, screen } from "electron";
import log from "electron-log/main";

import { PaseoIslandService, type PaseoIslandAgentPush } from "./service.js";

export const ISLAND_PUSH_CHANNEL = "paseo:island:push";
export const ISLAND_SET_ENABLED_CHANNEL = "paseo:island:set-enabled";
export const ISLAND_SET_MASCOT_SKIN_CHANNEL = "paseo:island:set-mascot-skin";
export const ISLAND_SET_SOUND_SETTINGS_CHANNEL = "paseo:island:set-sound-settings";
export const ISLAND_SET_DISPLAY_TARGET_CHANNEL = "paseo:island:set-display-target";
export const ISLAND_SET_VISIBLE_SESSION_CHANNEL = "paseo:island:set-visible-session";
export const ISLAND_ACKNOWLEDGE_READ_CHANNEL = "paseo:island:acknowledge-read";
export const ISLAND_REMOVE_AGENT_CHANNEL = "paseo:island:remove-agent";
export const ISLAND_GET_STATE_CHANNEL = "paseo:island:get-state";

export const ISLAND_PERMISSION_ACTION_EVENT = "paseo:event:island-permission-action";
export const ISLAND_FOCUS_AGENT_EVENT = "paseo:event:island-focus-agent";
export const ISLAND_OPEN_SETTINGS_EVENT = "paseo:event:island-open-settings";
export const ISLAND_NEW_MESSAGE_EVENT = "paseo:event:island-new-message";

interface RegisterIslandServiceDeps {
  focusAgentWindow: (agentId: string, serverId: string | null) => void;
}

function readPushList(value: unknown): PaseoIslandAgentPush[] {
  if (!Array.isArray(value)) return [];
  const list: PaseoIslandAgentPush[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    if (typeof record.agentId !== "string" || record.agentId.length === 0) continue;
    list.push({
      agentId: record.agentId,
      serverId: typeof record.serverId === "string" ? record.serverId : null,
      title: typeof record.title === "string" ? record.title : null,
      projectName: typeof record.projectName === "string" ? record.projectName : null,
      agentKind: typeof record.agentKind === "string" ? record.agentKind : "unknown",
      status: readStatus(record.status),
      pendingPermissions: readPermissions(record.pendingPermissions),
      requiresAttention: record.requiresAttention === true,
      attentionReason: readAttentionReason(record.attentionReason),
      lastAssistantText:
        typeof record.lastAssistantText === "string" ? record.lastAssistantText : null,
      statusText: typeof record.statusText === "string" ? record.statusText : null,
    });
  }
  return list;
}

function readStatus(value: unknown): PaseoIslandAgentPush["status"] {
  return value === "initializing" ||
    value === "idle" ||
    value === "running" ||
    value === "error" ||
    value === "closed"
    ? value
    : "idle";
}

function readAttentionReason(value: unknown): PaseoIslandAgentPush["attentionReason"] {
  return value === "finished" || value === "error" || value === "permission" ? value : null;
}

function readPermissions(value: unknown): PaseoIslandAgentPush["pendingPermissions"] {
  if (!Array.isArray(value)) return [];
  const out: PaseoIslandAgentPush["pendingPermissions"] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    if (typeof record.requestId !== "string" || record.requestId.length === 0) continue;
    out.push({
      requestId: record.requestId,
      toolName: typeof record.toolName === "string" ? record.toolName : "unknown",
      input:
        record.input && typeof record.input === "object" && !Array.isArray(record.input)
          ? (record.input as Record<string, unknown>)
          : {},
      ...(typeof record.title === "string" ? { title: record.title } : {}),
      ...(typeof record.displayName === "string" ? { displayName: record.displayName } : {}),
      ...(typeof record.description === "string" ? { description: record.description } : {}),
    });
  }
  return out;
}

function broadcast(channel: string, payload: unknown): void {
  const targets = BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed());
  log.info("[island] broadcast", { channel, windows: targets.length });
  for (const win of targets) {
    win.webContents.send(channel, payload);
  }
}

export function registerIslandService(deps: RegisterIslandServiceDeps): PaseoIslandService {
  const service = new PaseoIslandService({
    onEvent: (event) => {
      switch (event.type) {
        case "permission-action":
          broadcast(ISLAND_PERMISSION_ACTION_EVENT, {
            agentId: event.agentId,
            requestId: event.requestId,
            behavior: event.behavior,
          });
          break;
        case "focus-agent": {
          const serverId = service.getAgentServerId(event.agentId);
          try {
            deps.focusAgentWindow(event.agentId, serverId);
          } catch (error) {
            log.warn("[agent-island] focus agent window failed", {
              error: error instanceof Error ? error.message : String(error),
            });
          }
          broadcast(ISLAND_FOCUS_AGENT_EVENT, { agentId: event.agentId, serverId });
          break;
        }
        case "open-settings":
          broadcast(ISLAND_OPEN_SETTINGS_EVENT, {});
          break;
        case "new-message":
          broadcast(ISLAND_NEW_MESSAGE_EVENT, {});
          break;
      }
    },
  });

  ipcMain.handle(ISLAND_PUSH_CHANNEL, (_event, rawList: unknown) => {
    service.pushAgents(readPushList(rawList));
  });
  ipcMain.handle(ISLAND_SET_ENABLED_CHANNEL, (_event, enabled: unknown) => {
    service.setEnabled(enabled === true);
    return service.isEnabled;
  });
  ipcMain.handle(ISLAND_SET_MASCOT_SKIN_CHANNEL, (_event, skin: unknown) => {
    return service.setMascotSkin(skin);
  });
  ipcMain.handle(ISLAND_SET_SOUND_SETTINGS_CHANNEL, (_event, settings: unknown) => {
    service.setSoundSettings(settings);
  });
  ipcMain.handle(ISLAND_SET_DISPLAY_TARGET_CHANNEL, (_event, target: unknown) => {
    service.setDisplayTarget(target);
  });
  ipcMain.handle(ISLAND_SET_VISIBLE_SESSION_CHANNEL, (_event, sessionId: unknown) => {
    service.setVisibleSession(
      typeof sessionId === "string" || Array.isArray(sessionId) ? sessionId : null,
    );
  });
  ipcMain.handle(ISLAND_ACKNOWLEDGE_READ_CHANNEL, (_event, agentId: unknown) => {
    if (typeof agentId === "string" && agentId.length > 0) service.acknowledgeRead(agentId);
  });
  ipcMain.handle(ISLAND_REMOVE_AGENT_CHANNEL, (_event, agentId: unknown) => {
    if (typeof agentId === "string" && agentId.length > 0) service.removeAgent(agentId);
  });
  ipcMain.handle(ISLAND_GET_STATE_CHANNEL, () => {
    return {
      enabled: service.isEnabled,
      mascotSkin: service.getMascotSkin(),
      soundSettings: service.getSoundSettings(),
    };
  });

  const handleDisplayChange = (): void => service.refresh();
  screen.on("display-added", handleDisplayChange);
  screen.on("display-removed", handleDisplayChange);
  screen.on("display-metrics-changed", handleDisplayChange);

  app.on("browser-window-focus", () => service.setAppFocused(true));
  app.on("browser-window-blur", () => service.setAppFocused(false));

  return service;
}
