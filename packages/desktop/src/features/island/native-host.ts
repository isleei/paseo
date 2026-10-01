import { app } from "electron";
import { execFile, spawn, type ChildProcessByStdio } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Readable, Writable } from "node:stream";

import type { AgentMenuBarState, AgentIslandSoundChoice } from "./agent-island-shared.js";
import log from "electron-log/main";

const MAC_AGENT_ISLAND_HELPER_RESOURCE = path.join(
  "tools",
  "agent-island",
  "paseo-macos-agent-island-helper",
);
const MAC_AGENT_ISLAND_HELPER_SOURCE_RELATIVE = path.join(
  "native",
  "agent-island",
  "macos-agent-island-helper.swift",
);
const MAC_AGENT_ISLAND_RUNNING_GIF = "running-agent.gif";
const MAC_AGENT_ISLAND_RUNNING_GIF_SOURCE_RELATIVE = path.join(
  "native",
  "agent-island",
  MAC_AGENT_ISLAND_RUNNING_GIF,
);
const MAC_AGENT_ISLAND_MASCOTS_DIR = "mascots";
const MAC_AGENT_ISLAND_MASCOTS_SOURCE_RELATIVE = path.join(
  "native",
  "agent-island",
  MAC_AGENT_ISLAND_MASCOTS_DIR,
);
const MAC_AGENT_ISLAND_SOUNDS_DIR = "sounds";
const MAC_AGENT_ISLAND_SOUNDS_SOURCE_RELATIVE = path.join(
  "native",
  "agent-island",
  MAC_AGENT_ISLAND_SOUNDS_DIR,
);
const HELPER_START_TIMEOUT_MS = 2_500;
const HELPER_RESTART_MAX_ATTEMPTS = 3;
const HELPER_RESTART_BASE_DELAY_MS = 1_000;
const HELPER_RESTART_MAX_DELAY_MS = 5_000;
const HELPER_RESTART_HEALTHY_RESET_MS = 30_000;

type NativeProcess = ChildProcessByStdio<Writable, Readable, Readable>;

interface MacAgentIslandNativeHostOptions {
  onFocusSession: (sessionId: string) => void;
  onDismissSession: (sessionId: string) => void;
  onOpenSettings: () => void;
  onNewMessage: () => void;
  onToggleSound: () => void;
  onPermissionAction: (action: {
    requestId: string;
    action: "allow" | "allowForSession" | "deny";
  }) => void;
}

interface NativePayload {
  type?: unknown;
  message?: unknown;
  sessionId?: unknown;
  requestId?: unknown;
  action?: unknown;
}

interface NativeUpdate {
  type: "update";
  state: AgentMenuBarState;
}

/**
 * Spawns the macOS Swift/AppKit island renderer and speaks a newline-delimited
 * JSON protocol over stdio. Product state stays in TypeScript; the helper owns
 * one NSStatusItem and its click-open NSPopover.
 */
export class MacAgentIslandNativeHost {
  private child: NativeProcess | null = null;
  private starting: Promise<boolean> | null = null;
  private ready = false;
  private stdoutBuffer = "";
  private pendingUpdate: NativeUpdate | null = null;
  private pendingSounds: AgentIslandSoundChoice[] = [];
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private restartHealthyTimer: ReturnType<typeof setTimeout> | null = null;
  private restartAttempts = 0;
  private permanentlyFailed = false;
  private lifecycleToken = 0;
  private helperBinaryPath: string | null = null;
  private helperBinaryPromise: Promise<string> | null = null;

  constructor(private readonly options: MacAgentIslandNativeHostOptions) {}

  get failed(): boolean {
    return this.permanentlyFailed;
  }

  publish(state: AgentMenuBarState): boolean {
    if (this.permanentlyFailed) return false;
    this.pendingUpdate = { type: "update", state };
    if (this.ready && this.child) {
      this.flushPendingUpdate();
      return true;
    }
    if (this.restartTimer) return true;
    void this.ensureStarted();
    return true;
  }

  playSound(sound: AgentIslandSoundChoice): boolean {
    if (this.permanentlyFailed || (sound.type === "builtin" && sound.id === "none")) return false;
    if (this.ready && this.child) {
      this.sendSound(sound);
      return true;
    }
    this.pendingSounds.push(sound);
    if (this.restartTimer) return true;
    void this.ensureStarted();
    return true;
  }

  permissionResult(requestId: string, error: string | null): void {
    if (!this.ready || !this.child) return;
    this.child.stdin.write(`${JSON.stringify({ type: "permission-result", requestId, error })}\n`);
  }

  prepare(): void {
    if (this.permanentlyFailed) return;
    void this.resolveHelperBinary().catch((error) => {
      log.warn("native helper prewarm failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  stop(): void {
    this.permanentlyFailed = true;
    this.suspend();
  }

  /**
   * Temporarily tears down the helper when Menu bar is disabled.
   * Unlike stop(), this keeps the host reusable so a later publish can respawn.
   */
  suspend(): void {
    this.lifecycleToken += 1;
    this.clearRestartTimer();
    this.clearRestartHealthyTimer();
    this.restartAttempts = 0;
    this.pendingUpdate = null;
    this.pendingSounds.splice(0, this.pendingSounds.length);
    this.stdoutBuffer = "";
    const child = this.child;
    this.child = null;
    this.ready = false;
    this.starting = null;
    if (!child || child.killed) return;
    try {
      child.stdin.write(`${JSON.stringify({ type: "shutdown" })}\n`);
    } catch {
      // ignore, the process may already be gone
    }
    child.kill();
  }

  private async ensureStarted(): Promise<boolean> {
    if (this.ready && this.child) return true;
    if (this.starting) return this.starting;
    this.starting = this.startChildProcess().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async startChildProcess(): Promise<boolean> {
    const lifecycleToken = this.lifecycleToken;
    let binary: string;
    try {
      binary = await this.resolveHelperBinary();
    } catch (error) {
      this.permanentlyFailed = true;
      log.warn("native helper could not be prepared; Menu bar will remain hidden", {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
    if (this.lifecycleToken !== lifecycleToken || this.permanentlyFailed) {
      return false;
    }
    // Every resolve path funnels through the `settled`-guarded `settle()`
    // except the pre-spawn abort below; the rule cannot see the guard.
    /* eslint-disable promise/no-multiple-resolved */
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const child = spawn(binary, [], {
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          XDT_AGENT_ISLAND_ASSET_DIR: path.dirname(binary),
        },
      });
      if (this.lifecycleToken !== lifecycleToken || this.permanentlyFailed) {
        if (!child.killed) child.kill();
        resolve(false);
        return;
      }
      this.child = child;
      this.ready = false;
      this.stdoutBuffer = "";

      let startTimer: ReturnType<typeof setTimeout> | null = null;
      const settle = (ok: boolean): void => {
        if (settled) return;
        settled = true;
        if (startTimer) clearTimeout(startTimer);
        if (!ok && this.child === child) {
          this.child = null;
          this.ready = false;
          if (!child.killed) child.kill();
        }
        resolve(ok);
      };

      startTimer = setTimeout(() => {
        if (this.lifecycleToken !== lifecycleToken || this.permanentlyFailed) {
          settle(false);
          return;
        }
        log.warn("native helper did not become ready in time");
        settle(false);
        this.scheduleRestart(null, null);
      }, HELPER_START_TIMEOUT_MS);

      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        this.stdoutBuffer += chunk;
        let newlineIndex = this.stdoutBuffer.indexOf("\n");
        while (newlineIndex >= 0) {
          const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
          this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
          if (line) {
            this.handlePayloadLine(line, child, settle);
          }
          newlineIndex = this.stdoutBuffer.indexOf("\n");
        }
      });

      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        const text = chunk.trim();
        if (text) log.debug("native helper stderr", { text });
      });

      child.stdin.on("error", (error) => {
        const wasCurrentChild = this.child === child;
        if (wasCurrentChild) {
          this.child = null;
          this.ready = false;
          this.clearRestartHealthyTimer();
          if (!child.killed) child.kill();
        }
        log.warn("native helper stdin error", { error: error.message });
        if (!settled) {
          settle(false);
        }
        if (wasCurrentChild && this.pendingUpdate && !this.permanentlyFailed) {
          this.scheduleRestart(null, null);
        }
      });

      child.on("error", (error) => {
        const wasCurrentChild = this.child === child;
        if (wasCurrentChild) {
          this.child = null;
          this.ready = false;
          this.clearRestartHealthyTimer();
        }
        log.warn("native helper process error", { error: error.message });
        if (!settled) {
          settle(false);
        }
        if (wasCurrentChild && this.pendingUpdate && !this.permanentlyFailed) {
          this.scheduleRestart(null, null);
        }
      });

      child.on("exit", (code, signal) => {
        const wasCurrentChild = this.child === child;
        if (wasCurrentChild) {
          this.child = null;
          this.ready = false;
          this.clearRestartHealthyTimer();
        }
        if (!settled) {
          settle(false);
          if (wasCurrentChild && this.pendingUpdate && !this.permanentlyFailed) {
            this.scheduleRestart(code, signal);
          }
          return;
        }
        log.debug("native helper exited", { code, signal });
        if (wasCurrentChild && this.pendingUpdate && !this.permanentlyFailed) {
          this.scheduleRestart(code, signal);
        }
      });
    });
    /* eslint-enable promise/no-multiple-resolved */
  }

  private resolveHelperBinary(): Promise<string> {
    if (this.helperBinaryPath) return Promise.resolve(this.helperBinaryPath);
    if (this.helperBinaryPromise) return this.helperBinaryPromise;
    this.helperBinaryPromise = resolveMacAgentIslandHelperBinary()
      .then((binaryPath) => {
        this.helperBinaryPath = binaryPath;
        return binaryPath;
      })
      .finally(() => {
        this.helperBinaryPromise = null;
      });
    return this.helperBinaryPromise;
  }

  // Ported from Cindy; single dispatch over the helper's reverse protocol.
  // eslint-disable-next-line complexity
  private handlePayloadLine(
    line: string,
    child: NativeProcess,
    settle: (ok: boolean) => void,
  ): void {
    let payload: NativePayload;
    try {
      payload = JSON.parse(line) as NativePayload;
    } catch {
      log.debug("native helper emitted non-json line", { line });
      return;
    }

    if (payload.type === "ready") {
      if (this.child !== child) return;
      this.ready = true;
      this.armRestartHealthyReset(child);
      settle(true);
      this.flushPendingUpdate();
      this.flushPendingSounds();
      log.info("native helper ready");
      return;
    }

    if (payload.type === "error") {
      const message =
        typeof payload.message === "string" ? payload.message : "Native menu bar helper failed.";
      log.warn("native helper error", { message });
      if (!this.ready) settle(false);
      return;
    }

    if (
      payload.type === "focus-session" &&
      this.child === child &&
      typeof payload.sessionId === "string"
    ) {
      log.info("native helper focus-session", { sessionId: payload.sessionId });
      this.options.onFocusSession(payload.sessionId);
      return;
    }

    if (
      payload.type === "dismiss-session" &&
      this.child === child &&
      typeof payload.sessionId === "string"
    ) {
      log.info("native helper dismiss-session", { sessionId: payload.sessionId });
      this.options.onDismissSession(payload.sessionId);
      return;
    }

    if (
      payload.type === "permission-action" &&
      this.child === child &&
      typeof payload.requestId === "string" &&
      isAgentIslandPermissionAction(payload.action)
    ) {
      log.info("native helper permission-action", {
        requestId: payload.requestId,
        action: payload.action,
      });
      this.options.onPermissionAction({
        requestId: payload.requestId,
        action: payload.action,
      });
      return;
    }

    if (payload.type === "open-settings" && this.child === child) {
      log.info("native helper open-settings");
      this.options.onOpenSettings();
      return;
    }

    if (payload.type === "new-message" && this.child === child) {
      log.info("native helper new-message");
      this.options.onNewMessage();
      return;
    }

    if (payload.type === "toggle-sound" && this.child === child) {
      log.info("native helper toggle-sound");
      this.options.onToggleSound();
      return;
    }
  }

  private flushPendingUpdate(): void {
    if (!this.ready || !this.child || !this.pendingUpdate) return;
    try {
      this.child.stdin.write(`${JSON.stringify(this.pendingUpdate)}\n`);
    } catch (error) {
      log.warn("failed to send native helper update", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private flushPendingSounds(): void {
    if (!this.ready || !this.child || this.pendingSounds.length === 0) return;
    const sounds = this.pendingSounds.splice(0, this.pendingSounds.length);
    for (const sound of sounds) {
      this.sendSound(sound);
    }
  }

  private sendSound(sound: AgentIslandSoundChoice): void {
    if (!this.ready || !this.child) return;
    const payload =
      sound.type === "custom"
        ? { type: "play-sound", soundPath: sound.path }
        : { type: "play-sound", soundId: sound.id };
    try {
      this.child.stdin.write(`${JSON.stringify(payload)}\n`);
    } catch (error) {
      log.warn("failed to send native helper sound command", {
        sound: sound.type === "custom" ? sound.path : sound.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private scheduleRestart(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.restartTimer || this.permanentlyFailed) return;
    if (this.restartAttempts >= HELPER_RESTART_MAX_ATTEMPTS) {
      this.permanentlyFailed = true;
      log.warn("native helper restart limit reached; Menu bar will remain hidden", {
        code,
        signal,
      });
      return;
    }
    this.restartAttempts += 1;
    const delayMs = Math.min(
      HELPER_RESTART_BASE_DELAY_MS * 2 ** (this.restartAttempts - 1),
      HELPER_RESTART_MAX_DELAY_MS,
    );
    log.warn("native helper exited unexpectedly; scheduling restart", {
      attempt: this.restartAttempts,
      code,
      signal,
      delayMs,
    });
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (this.ready || this.child || this.permanentlyFailed) return;
      void this.ensureStarted();
    }, delayMs);
  }

  private clearRestartTimer(): void {
    if (!this.restartTimer) return;
    clearTimeout(this.restartTimer);
    this.restartTimer = null;
  }

  private armRestartHealthyReset(child: NativeProcess): void {
    this.clearRestartHealthyTimer();
    this.restartHealthyTimer = setTimeout(() => {
      this.restartHealthyTimer = null;
      if (this.child !== child || !this.ready) return;
      this.restartAttempts = 0;
    }, HELPER_RESTART_HEALTHY_RESET_MS);
  }

  private clearRestartHealthyTimer(): void {
    if (!this.restartHealthyTimer) return;
    clearTimeout(this.restartHealthyTimer);
    this.restartHealthyTimer = null;
  }
}

function isAgentIslandPermissionAction(
  value: unknown,
): value is "allow" | "allowForSession" | "deny" {
  return value === "allow" || value === "allowForSession" || value === "deny";
}

async function resolveMacAgentIslandHelperBinary(): Promise<string> {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, MAC_AGENT_ISLAND_HELPER_RESOURCE);
  }
  await buildDevMacAgentIslandHelper();
  return getMacAgentIslandHelperDevBinary();
}

async function buildDevMacAgentIslandHelper(): Promise<void> {
  const source = resolveDevMacAgentIslandHelperSource();
  const binary = getMacAgentIslandHelperDevBinary();
  if (!fs.existsSync(source)) {
    throw new Error(`Menu bar helper source missing at ${source}`);
  }
  const sourceHash = fileSha256(source);
  const hashFile = getMacAgentIslandHelperDevHashFile();
  copyDevMacAgentIslandAssets();
  if (
    fs.existsSync(binary) &&
    fs.existsSync(hashFile) &&
    fs.readFileSync(hashFile, "utf8").trim() === sourceHash
  ) {
    return;
  }
  fs.mkdirSync(path.dirname(binary), { recursive: true });
  // Cold -O compile of the single-file helper is ~20s+ on this machine;
  // a 20s cap kills the first build and permanently hides the island.
  await execFilePromise("swiftc", [source, "-O", "-o", binary], 120_000);
  fs.chmodSync(binary, 0o755);
  fs.writeFileSync(hashFile, `${sourceHash}\n`, "utf8");
  log.info("built dev macOS menu bar helper", { path: binary });
}

function resolveDevSourceCandidate(relative: string): string {
  const appPathSource = path.join(app.getAppPath(), relative);
  if (fs.existsSync(appPathSource)) return appPathSource;
  // dist/features/island/*.js -> packages/desktop/<relative>
  const distSource = path.join(__dirname, "..", "..", "..", relative);
  if (fs.existsSync(distSource)) return distSource;
  return path.join(__dirname, "..", "..", relative);
}

function resolveDevMacAgentIslandHelperSource(): string {
  return resolveDevSourceCandidate(MAC_AGENT_ISLAND_HELPER_SOURCE_RELATIVE);
}

function resolveDevMacAgentIslandRunningGifSource(): string {
  return resolveDevSourceCandidate(MAC_AGENT_ISLAND_RUNNING_GIF_SOURCE_RELATIVE);
}

function resolveDevMacAgentIslandMascotsSource(): string {
  return resolveDevSourceCandidate(MAC_AGENT_ISLAND_MASCOTS_SOURCE_RELATIVE);
}

function resolveDevMacAgentIslandSoundsSource(): string {
  return resolveDevSourceCandidate(MAC_AGENT_ISLAND_SOUNDS_SOURCE_RELATIVE);
}

function getMacAgentIslandHelperDevBinary(): string {
  return path.join(app.getPath("userData"), "agent-island", "paseo-macos-agent-island-helper");
}

function getMacAgentIslandHelperDevHashFile(): string {
  return `${getMacAgentIslandHelperDevBinary()}.sha256`;
}

function fileSha256(filePath: string): string {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function copyDevMacAgentIslandAssets(): void {
  const source = resolveDevMacAgentIslandRunningGifSource();
  if (!fs.existsSync(source)) {
    throw new Error(`Menu bar running GIF missing at ${source}`);
  }
  const dest = path.join(
    path.dirname(getMacAgentIslandHelperDevBinary()),
    MAC_AGENT_ISLAND_RUNNING_GIF,
  );
  copyFileIfChanged(source, dest);
  copyDirectory(
    resolveDevMacAgentIslandMascotsSource(),
    path.join(path.dirname(getMacAgentIslandHelperDevBinary()), MAC_AGENT_ISLAND_MASCOTS_DIR),
  );
  copyDirectory(
    resolveDevMacAgentIslandSoundsSource(),
    path.join(path.dirname(getMacAgentIslandHelperDevBinary()), MAC_AGENT_ISLAND_SOUNDS_DIR),
  );
}

function copyDirectory(sourceDir: string, destDir: string): void {
  if (!fs.existsSync(sourceDir)) {
    throw new Error(`Menu bar asset directory missing at ${sourceDir}`);
  }
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const source = path.join(sourceDir, entry.name);
    const dest = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(source, dest);
      continue;
    }
    if (!entry.isFile()) continue;
    copyFileIfChanged(source, dest);
  }
}

function copyFileIfChanged(source: string, dest: string): void {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest)) {
    const sourceStat = fs.statSync(source);
    const destStat = fs.statSync(dest);
    if (destStat.mtimeMs >= sourceStat.mtimeMs && destStat.size === sourceStat.size) {
      return;
    }
  }
  fs.copyFileSync(source, dest);
}

function execFilePromise(file: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = execFile(file, args, { timeout: timeoutMs }, (error, _stdout, stderr) => {
      if (error) {
        const message = stderr?.trim() ? `${error.message}: ${stderr.trim()}` : error.message;
        reject(new Error(message));
        return;
      }
      resolve();
    });
    child.on("error", reject);
  });
}
