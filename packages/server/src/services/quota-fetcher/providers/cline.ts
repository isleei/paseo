import { existsSync, promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Logger } from "pino";
import { z } from "zod";
import type {
  ProviderUsage,
  ProviderUsageBalance,
  ProviderUsageWindow,
} from "../../../server/messages.js";
import type { ProviderApiFetch, ProviderUsageFetcher } from "../provider.js";
import {
  balanceToneFromRemaining,
  fetchProviderApi,
  toneFromUsedPct,
  unavailableUsage,
  windowFromUsedPct,
} from "../usage.js";

const CLINE_API_BASE_URL = "https://api.cline.bot";

const ClineUserInfoSchema = z
  .object({
    clineUserId: z.string().nullish(),
  })
  .passthrough();

const ClineAuthSchema = z
  .object({
    accessToken: z.string().nullish(),
    refreshToken: z.string().nullish(),
    expiresAt: z.unknown().nullish(),
    metadata: z
      .object({
        userInfo: ClineUserInfoSchema.nullish(),
      })
      .passthrough()
      .nullish(),
  })
  .passthrough();

const ClineProvidersFileSchema = z
  .object({
    providers: z.record(
      z.string(),
      z
        .object({
          settings: z
            .object({
              auth: ClineAuthSchema.nullish(),
            })
            .passthrough()
            .nullish(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

const ClineProfileSchema = z
  .object({
    id: z.string(),
  })
  .passthrough();

const ClinePlanSchema = z
  .object({
    plan: z
      .object({
        name: z.string().nullish(),
        displayName: z.string().nullish(),
      })
      .passthrough()
      .nullish(),
  })
  .passthrough();

const ClineUsageLimitSchema = z
  .object({
    type: z.string().nullish(),
    percentUsed: z.unknown().nullish(),
    resetsAt: z.string().nullish(),
  })
  .passthrough();

const ClineUsageLimitsSchema = z
  .object({
    limits: z.array(z.unknown()).nullish(),
  })
  .passthrough();

const ClineBalanceSchema = z
  .object({
    userId: z.string().nullish(),
    balance: z.unknown().nullish(),
  })
  .passthrough();

type ClineUsageLimit = z.infer<typeof ClineUsageLimitSchema>;

interface ClineQuotaProviderOptions {
  logger: Logger;
  fetch?: ProviderApiFetch;
  /** Override home directory (tests). Production uses os.homedir(). */
  homeDir?: string;
}

interface ClineCredential {
  token: string;
  userId: string | null;
  expiresAt: number | null;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Cline money fields are integers in millionths of a US dollar. */
function toUsdDollars(value: unknown): number | null {
  const raw = toFiniteNumber(value);
  return raw === null ? null : raw / 1_000_000;
}

function clampPercent(value: number | null): number | null {
  if (value === null) return null;
  return Math.max(0, Math.min(100, value));
}

function prettifyLimitType(type: string | undefined, index: number): { id: string; label: string } {
  switch ((type ?? "").toLowerCase()) {
    case "five_hour":
      return { id: "five_hour", label: "5-hour" };
    case "weekly":
      return { id: "weekly", label: "Weekly" };
    case "monthly":
      return { id: "monthly", label: "Monthly" };
    default: {
      const cleaned = (type ?? "").trim().replace(/_+/g, " ");
      const label = cleaned ? cleaned.charAt(0).toUpperCase() + cleaned.slice(1) : null;
      return { id: `limit_${index + 1}`, label: label ?? `Limit ${index + 1}` };
    }
  }
}

function parseUsageLimit(value: unknown): ClineUsageLimit | null {
  const parsed = ClineUsageLimitSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function windowFromLimit(limit: ClineUsageLimit, index: number): ProviderUsageWindow | null {
  const percent = clampPercent(toFiniteNumber(limit.percentUsed));
  if (percent === null) return null;
  const identity = prettifyLimitType(limit.type ?? undefined, index);
  return windowFromUsedPct({
    id: identity.id,
    label: identity.label,
    utilizationPct: percent,
    resetsAt: limit.resetsAt,
    tone: toneFromUsedPct(percent),
  });
}

function balanceFromRaw(value: unknown): ProviderUsageBalance | null {
  const dollars = toUsdDollars(value);
  if (dollars === null) return null;
  return {
    id: "credits",
    label: "Credits",
    used: null,
    remaining: dollars,
    limit: null,
    unit: "usd",
    tone: balanceToneFromRemaining(dollars),
  };
}

/**
 * Unwrap a Cline API envelope. Plan and usage-limit endpoints return
 * `{ success: true, data: null }` for accounts without that product, and 404
 * for unknown paths; both mean "nothing to show", not a failure.
 */
function envelopeData(payload: unknown): { ok: boolean; data: unknown } {
  if (payload !== null && typeof payload === "object" && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>;
    if ("success" in record) {
      if (record["success"] === false) return { ok: false, data: null };
      return { ok: true, data: "data" in record ? record["data"] : null };
    }
  }
  return { ok: true, data: payload };
}

export class ClineQuotaProvider implements ProviderUsageFetcher {
  readonly providerId = "cline";
  readonly displayName = "Cline";

  private readonly logger: Logger;
  private readonly fetchApi: ProviderApiFetch;
  private readonly homeDir: string | undefined;

  constructor(options: ClineQuotaProviderOptions) {
    this.logger = options.logger.child({ module: "cline-quota-provider" });
    this.fetchApi = options.fetch ?? fetch;
    this.homeDir = options.homeDir;
  }

  async fetchUsage(): Promise<ProviderUsage> {
    const credentials = await this.readCredentials();
    if (credentials.length === 0) return unavailableUsage(this);

    for (const credential of credentials) {
      const usage = await this.fetchUsageWithCredential(credential);
      // Null means this credential was rejected; try the next Cline login.
      if (usage) return usage;
    }
    this.logger.debug("Cline usage fetch failed for every stored credential");
    return unavailableUsage(this);
  }

  private async fetchUsageWithCredential(
    credential: ClineCredential,
  ): Promise<ProviderUsage | null> {
    const plan = await this.fetchEndpoint(credential.token, "/api/v1/users/me/plan", "plan");
    if (plan === "unauthorized") return null;
    const limits = await this.fetchEndpoint(
      credential.token,
      "/api/v1/users/me/plan/usage-limits",
      "usage-limits",
    );
    if (limits === "unauthorized") return null;

    const userId = credential.userId ?? (await this.fetchUserId(credential.token));
    const balance =
      userId === null
        ? null
        : await this.fetchEndpoint(
            credential.token,
            `/api/v1/users/${encodeURIComponent(userId)}/balance`,
            "balance",
          );
    if (balance === "unauthorized") return null;

    const planData = plan === null ? null : ClinePlanSchema.safeParse(plan);
    const planLabel =
      planData?.success === true
        ? (planData.data.plan?.displayName ?? planData.data.plan?.name ?? null)
        : null;

    const windows = clineUsageWindows(limits, this.logger);
    const balanceData = balance === null ? null : ClineBalanceSchema.safeParse(balance);
    const creditBalance =
      balanceData?.success === true ? balanceFromRaw(balanceData.data.balance) : null;

    return {
      providerId: this.providerId,
      displayName: this.displayName,
      status: "available",
      planLabel,
      windows,
      balances: creditBalance ? [creditBalance] : [],
      details: [],
      error: null,
    };
  }

  /**
   * GET a Cline endpoint. Returns the unwrapped data, null when the endpoint has
   * nothing to show (404, or a `data: null` envelope), or "unauthorized" when the
   * credential itself was rejected so the caller can try the next login.
   */
  private async fetchEndpoint(token: string, path: string, label: string): Promise<unknown> {
    let res: Response;
    try {
      res = await fetchProviderApi(this.fetchApi, `${CLINE_API_BASE_URL}${path}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      });
    } catch (error) {
      this.logger.debug({ err: error, endpoint: label }, "Cline usage request failed");
      return null;
    }
    if (res.status === 401 || res.status === 403) {
      return "unauthorized";
    }
    if (res.status === 404) {
      return null;
    }
    if (!res.ok) {
      this.logger.debug({ status: res.status, endpoint: label }, "Cline usage fetch failed");
      return null;
    }
    let payload: unknown;
    try {
      payload = await res.json();
    } catch (error) {
      this.logger.debug({ err: error, endpoint: label }, "Cline usage response is not JSON");
      return null;
    }
    const envelope = envelopeData(payload);
    if (!envelope.ok) {
      this.logger.debug({ endpoint: label }, "Cline usage fetch reported failure");
      return null;
    }
    return envelope.data;
  }

  private async fetchUserId(token: string): Promise<string | null> {
    const profile = await this.fetchEndpoint(token, "/api/v1/users/me", "profile");
    if (profile === null || profile === "unauthorized") return null;
    const parsed = ClineProfileSchema.safeParse(profile);
    return parsed.success ? parsed.data.id : null;
  }

  private async readCredentials(): Promise<ClineCredential[]> {
    const environmentToken = process.env["CLINE_API_KEY"] || process.env["CLINE_TOKEN"];
    if (environmentToken) {
      // Read-only on credentials; the Cline CLI owns refresh. See docs/providers.md.
      return [{ token: environmentToken, userId: null, expiresAt: null }];
    }

    const path = join(this.homeDir ?? homedir(), ".cline", "data", "settings", "providers.json");
    if (!existsSync(path)) return [];
    let parsed: z.infer<typeof ClineProvidersFileSchema>;
    try {
      parsed = ClineProvidersFileSchema.parse(JSON.parse(await fs.readFile(path, "utf8")));
    } catch {
      return [];
    }
    const credentials: ClineCredential[] = [];
    for (const entry of Object.values(parsed.providers)) {
      const auth = entry.settings?.auth;
      if (typeof auth?.accessToken !== "string" || auth.accessToken.length === 0) continue;
      credentials.push({
        token: auth.accessToken,
        userId: auth.metadata?.userInfo?.clineUserId ?? null,
        expiresAt: toFiniteNumber(auth.expiresAt),
      });
    }
    // Freshest login first; tokens without an expiry (API keys) go before expiring ones.
    credentials.sort((left, right) => (right.expiresAt ?? Infinity) - (left.expiresAt ?? Infinity));
    return credentials;
  }
}

function clineUsageWindows(limits: unknown, logger: Pick<Logger, "debug">): ProviderUsageWindow[] {
  if (limits === null) return [];
  const parsed = ClineUsageLimitsSchema.safeParse(limits);
  if (!parsed.success || !Array.isArray(parsed.data.limits)) {
    logger.debug("Ignoring malformed Cline usage limits");
    return [];
  }
  const windows: ProviderUsageWindow[] = [];
  parsed.data.limits.forEach((rawLimit, index) => {
    const limit = parseUsageLimit(rawLimit);
    if (!limit) {
      logger.debug({ index }, "Ignoring malformed Cline usage limit window");
      return;
    }
    const window = windowFromLimit(limit, index);
    if (window) windows.push(window);
  });
  return windows;
}
