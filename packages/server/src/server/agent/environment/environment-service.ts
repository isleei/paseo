import type pino from "pino";
import { execCommand } from "../../../utils/spawn.js";
import type { AgentProvider } from "../agent-sdk-types.js";
import type { ProviderSnapshotManager } from "../provider-snapshot-manager.js";
import type { EnvironmentCheckEntry, EnvironmentUpgradeEntry } from "@getpaseo/protocol/messages";
import { buildVersionProbeCommand } from "../providers/generic-acp-agent.js";
import compareVersions from "semver/functions/compare.js";

export interface EnvironmentServiceOptions {
  providerSnapshotManager: ProviderSnapshotManager;
  logger: pino.Logger;
}

const NPM_PROBE_TIMEOUT_MS = 15_000;
const NPM_VIEW_TIMEOUT_MS = 30_000;
const NPM_INSTALL_TIMEOUT_MS = 300_000;
const NPM_MAX_BUFFER = 10 * 1024 * 1024;

const PACKAGE_RUNNERS = new Set(["npx", "bunx", "pnpm", "uvx"]);

/** Verified npm package behind a builtin provider binary. Each entry was
 * confirmed against the live npm registry (and the in-repo ACP catalog where
 * present); grok/pi have no verified package and stay unmapped. A wrong entry
 * degrades to check-failed/failed with the real command output — it can never
 * fabricate a version or run an unrelated install. */
const KNOWN_NPM_PACKAGES: Partial<Record<AgentProvider, string>> = {
  claude: "@anthropic-ai/claude-code",
  codex: "@openai/codex",
  opencode: "opencode-ai",
  gemini: "@google/gemini-cli",
  copilot: "@github/copilot",
};

export function resolveKnownNpmPackage(provider: AgentProvider): string | null {
  return KNOWN_NPM_PACKAGES[provider] ?? null;
}

export function buildNpmUpgradeCommand(packageName: string): string {
  return `npm install -g ${packageName}@latest`;
}

interface LaunchChannelInfo {
  channel: "npm" | "binary";
  packageName: string | null;
}

/** Resolve the npm package name from a package-runner launch argv.
 * e.g. ["npx", "-y", "@google/gemini-cli@0.52.0", "--acp"] -> "@google/gemini-cli". */
export function resolveNpmPackageName(args: readonly string[]): string | null {
  let index = 0;
  if (args.length > 0 && args[0] === "dlx") index = 1;
  for (; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--package" || arg === "-p") {
      const value = args[index + 1];
      if (value && !value.startsWith("-")) return stripVersionSpec(value);
      continue;
    }
    if (!arg.startsWith("-")) return stripVersionSpec(arg);
  }
  return null;
}

function stripVersionSpec(spec: string): string {
  const lastAt = spec.lastIndexOf("@");
  if (lastAt > 0) return spec.slice(0, lastAt);
  return spec;
}

function parseInstalledVersion(output: string): string | null {
  const match = output.match(/\b(\d+\.\d+\.\d+[^\s)]*)/);
  return match?.[1] ?? null;
}

async function runCommand(
  command: string,
  args: string[],
  options: { timeout: number; env?: Record<string, string> },
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execCommand(command, args, {
      timeout: options.timeout,
      maxBuffer: NPM_MAX_BUFFER,
      env: { ...process.env, ...options.env },
    });
    return { exitCode: 0, stdout, stderr };
  } catch (error) {
    const err = error as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      code?: number;
    };
    return {
      exitCode: typeof err.code === "number" ? err.code : 1,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? String(error),
    };
  }
}

export class EnvironmentService {
  private readonly providerSnapshotManager: ProviderSnapshotManager;
  private readonly logger: pino.Logger;

  constructor(options: EnvironmentServiceOptions) {
    this.providerSnapshotManager = options.providerSnapshotManager;
    this.logger = options.logger.child({ module: "environment-service" });
  }

  async check(): Promise<EnvironmentCheckEntry[]> {
    const entries = await this.providerSnapshotManager.listProviders();
    const enabled = entries.filter((entry) => entry.enabled);
    return Promise.all(
      enabled.map((entry) =>
        this.checkProvider(entry.provider, entry.label ?? entry.provider, entry.iconSvg),
      ),
    );
  }

  private async checkProvider(
    provider: AgentProvider,
    label: string,
    iconSvg?: string,
  ): Promise<EnvironmentCheckEntry> {
    const checkedAt = new Date().toISOString();
    const base: EnvironmentCheckEntry = {
      provider,
      label,
      ...(iconSvg !== undefined ? { iconSvg } : {}),
      status: "unknown-channel",
      installedVersion: null,
      latestVersion: null,
      channel: null,
      checkedAt,
    };
    const client = this.providerSnapshotManager.getProviderClient?.(provider);
    if (!client?.getLaunchSpec) {
      return base;
    }
    const spec = await client.getLaunchSpec().catch((error) => {
      this.logger.debug({ err: error, provider }, "Failed to resolve provider launch spec");
      return null;
    });
    if (!spec) {
      return { ...base, status: "unavailable" };
    }

    const channelInfo = await this.resolveChannel(provider, spec.command);

    const versionProbe = buildVersionProbeCommand(spec.command);
    const installedResult = await runCommand(versionProbe.command, versionProbe.args, {
      timeout: NPM_PROBE_TIMEOUT_MS,
      env: spec.env,
    });
    const installedVersion =
      installedResult.exitCode === 0 ? parseInstalledVersion(installedResult.stdout) : null;

    const latestVersion = await this.fetchLatestVersion(channelInfo.packageName);

    const status = resolveCheckStatus({
      installedVersion,
      latestVersion,
      channel: channelInfo.channel,
      packageName: channelInfo.packageName,
      probeOk: installedResult.exitCode === 0,
      probeError: installedResult.stderr.trim(),
    });
    const upgradeHint = buildBinaryUpgradeHint(channelInfo, installedVersion, latestVersion);
    return {
      ...base,
      status: status.status,
      installedVersion,
      latestVersion,
      channel: channelInfo.channel,
      ...(channelInfo.packageName ? { packageName: channelInfo.packageName } : {}),
      ...(upgradeHint ? { upgradeHint } : {}),
      ...(status.error ? { error: status.error } : {}),
    };
  }

  private async resolveChannel(
    provider: AgentProvider,
    command: [string, ...string[]],
  ): Promise<LaunchChannelInfo> {
    const [launcher, ...args] = command;
    if (PACKAGE_RUNNERS.has(launcher)) {
      return { channel: "npm", packageName: resolveNpmPackageName(args) };
    }
    // A binary launcher can still be npm-managed (npm install -g puts a plain
    // binary on PATH). Only claim the npm channel when the global tree proves
    // it — otherwise an npm upgrade would shadow a brew/curl install with a
    // duplicate copy instead of upgrading it.
    const known = resolveKnownNpmPackage(provider);
    if (known && (await this.isNpmGlobalInstall(known))) {
      return { channel: "npm", packageName: known };
    }
    return { channel: "binary", packageName: known };
  }

  private async fetchLatestVersion(packageName: string | null): Promise<string | null> {
    if (!packageName) return null;
    const viewResult = await runCommand("npm", ["view", packageName, "version", "--json"], {
      timeout: NPM_VIEW_TIMEOUT_MS,
    });
    if (viewResult.exitCode !== 0) return null;
    try {
      const parsed = JSON.parse(viewResult.stdout) as unknown;
      return typeof parsed === "string" ? parsed : null;
    } catch {
      return null;
    }
  }

  private async isNpmGlobalInstall(packageName: string): Promise<boolean> {
    const result = await runCommand("npm", ["ls", "-g", packageName, "--depth=0", "--json"], {
      timeout: NPM_PROBE_TIMEOUT_MS,
    });
    try {
      const parsed = JSON.parse(result.stdout) as { dependencies?: Record<string, unknown> };
      return Boolean(parsed?.dependencies?.[packageName]);
    } catch {
      return false;
    }
  }

  async upgrade(providers?: AgentProvider[]): Promise<EnvironmentUpgradeEntry[]> {
    const checkEntries = await this.check();
    const targets = providers
      ? checkEntries.filter((entry) => providers.includes(entry.provider))
      : checkEntries.filter((entry) => entry.status === "update-available");
    return Promise.all(targets.map((entry) => this.upgradeProvider(entry)));
  }

  private async upgradeProvider(entry: EnvironmentCheckEntry): Promise<EnvironmentUpgradeEntry> {
    if (entry.channel !== "npm" || !entry.packageName) {
      return {
        provider: entry.provider,
        status: "unsupported",
        previousVersion: entry.installedVersion,
        newVersion: null,
      };
    }
    if (entry.status === "ok") {
      return {
        provider: entry.provider,
        status: "up-to-date",
        previousVersion: entry.installedVersion,
        newVersion: entry.installedVersion,
      };
    }
    const installResult = await runCommand(
      "npm",
      ["install", "-g", `${entry.packageName}@latest`],
      { timeout: NPM_INSTALL_TIMEOUT_MS },
    );
    if (installResult.exitCode !== 0) {
      const error =
        installResult.stderr.trim() ||
        installResult.stdout.trim() ||
        `npm exited with code ${installResult.exitCode}`;
      this.logger.warn({ err: error, provider: entry.provider }, "Provider upgrade failed");
      return {
        provider: entry.provider,
        status: "failed",
        previousVersion: entry.installedVersion,
        newVersion: null,
        error,
      };
    }
    // Re-probe the real installed version — never report success on a failed sync.
    const client = this.providerSnapshotManager.getProviderClient?.(entry.provider);
    const spec = await client?.getLaunchSpec?.().catch(() => null);
    let newVersion: string | null = null;
    if (spec) {
      const versionProbe = buildVersionProbeCommand(spec.command);
      const probe = await runCommand(versionProbe.command, versionProbe.args, {
        timeout: NPM_PROBE_TIMEOUT_MS,
        env: spec.env,
      });
      if (probe.exitCode === 0) newVersion = parseInstalledVersion(probe.stdout);
    }
    return {
      provider: entry.provider,
      status: newVersion ? "upgraded" : "failed",
      previousVersion: entry.installedVersion,
      newVersion,
      ...(newVersion
        ? {}
        : { error: "Upgrade command succeeded but re-probing the installed version failed" }),
    };
  }
}

// Binary installs never get an executable upgrade: surface the exact manual
// command when an update is known instead of a dead button.
export function buildBinaryUpgradeHint(
  channelInfo: LaunchChannelInfo,
  installedVersion: string | null,
  latestVersion: string | null,
): string | null {
  if (channelInfo.channel !== "binary" || !channelInfo.packageName) return null;
  if (!installedVersion || !latestVersion) return null;
  const comparison = safeCompare(installedVersion, latestVersion);
  if (comparison === null || comparison >= 0) return null;
  return buildNpmUpgradeCommand(channelInfo.packageName);
}

function resolveCheckStatus(input: {
  installedVersion: string | null;
  latestVersion: string | null;
  channel: "npm" | "binary";
  packageName: string | null;
  probeOk: boolean;
  probeError: string;
}): { status: EnvironmentCheckEntry["status"]; error?: string } {
  if (!input.probeOk) {
    return { status: "unavailable", error: input.probeError || "Version probe failed" };
  }
  if (input.channel === "npm" && input.packageName && input.latestVersion) {
    if (!input.installedVersion)
      return { status: "check-failed", error: "Could not parse installed version" };
    const comparison = safeCompare(input.installedVersion, input.latestVersion);
    if (comparison !== null && comparison < 0) return { status: "update-available" };
    return { status: "ok" };
  }
  if (input.channel === "npm" && input.packageName && !input.latestVersion) {
    return { status: "check-failed", error: "Could not resolve latest version from npm" };
  }
  return { status: "unknown-channel" };
}

function safeCompare(a: string, b: string): number | null {
  try {
    return compareVersions(a, b);
  } catch {
    return null;
  }
}
