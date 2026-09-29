import type { UsageInput } from "../shared/input.js";
import { existsSync, promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import {
  balanceToneFromRemaining,
  toneFromUsedPct,
  unavailableUsage,
  windowFromUsedPct,
  type UsageBalance,
  type UsageReport,
  type UsageWindow,
} from "@getpaseo/plugin/server/usage";

const CLINE_API_BASE_URL = "https://api.cline.bot";
const CLINE_HTTP_TIMEOUT_MS = 15_000;

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

function windowFromLimit(limit: ClineUsageLimit, index: number): UsageWindow | null {
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

function balanceFromRaw(value: unknown): UsageBalance | null {
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

function clineUsageWindows(limits: unknown): UsageWindow[] {
  if (limits === null) return [];
  const parsed = ClineUsageLimitsSchema.safeParse(limits);
  if (!parsed.success || !Array.isArray(parsed.data.limits)) return [];
  const windows: UsageWindow[] = [];
  parsed.data.limits.forEach((rawLimit, index) => {
    const limit = parseUsageLimit(rawLimit);
    if (!limit) return;
    const window = windowFromLimit(limit, index);
    if (window) windows.push(window);
  });
  return windows;
}

async function fetchEndpoint(
  fetchApi: typeof fetch,
  token: string,
  path: string,
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchApi(`${CLINE_API_BASE_URL}${path}`, {
      signal: AbortSignal.timeout(CLINE_HTTP_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });
  } catch {
    return null;
  }
  if (res.status === 401 || res.status === 403) {
    return "unauthorized";
  }
  if (res.status === 404 || !res.ok) {
    return null;
  }
  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    return null;
  }
  const envelope = envelopeData(payload);
  if (!envelope.ok) return null;
  return envelope.data;
}

async function fetchUserId(fetchApi: typeof fetch, token: string): Promise<string | null> {
  const profile = await fetchEndpoint(fetchApi, token, "/api/v1/users/me");
  if (profile === null || profile === "unauthorized") return null;
  const parsed = ClineProfileSchema.safeParse(profile);
  return parsed.success ? parsed.data.id : null;
}

async function readCredentials(): Promise<ClineCredential[]> {
  const environmentToken = process.env["CLINE_API_KEY"] || process.env["CLINE_TOKEN"];
  if (environmentToken) {
    // Read-only on credentials; the Cline CLI owns refresh. See docs/providers.md.
    return [{ token: environmentToken, userId: null, expiresAt: null }];
  }

  const path = join(homedir(), ".cline", "data", "settings", "providers.json");
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

async function fetchUsageWithCredential(
  fetchApi: typeof fetch,
  credential: ClineCredential,
): Promise<UsageReport | null> {
  const plan = await fetchEndpoint(fetchApi, credential.token, "/api/v1/users/me/plan");
  if (plan === "unauthorized") return null;
  const limits = await fetchEndpoint(
    fetchApi,
    credential.token,
    "/api/v1/users/me/plan/usage-limits",
  );
  if (limits === "unauthorized") return null;

  const userId = credential.userId ?? (await fetchUserId(fetchApi, credential.token));
  const balance =
    userId === null
      ? null
      : await fetchEndpoint(
          fetchApi,
          credential.token,
          `/api/v1/users/${encodeURIComponent(userId)}/balance`,
        );
  if (balance === "unauthorized") return null;

  const planData = plan === null ? null : ClinePlanSchema.safeParse(plan);
  const planLabel =
    planData?.success === true
      ? (planData.data.plan?.displayName ?? planData.data.plan?.name ?? undefined)
      : undefined;

  const windows = clineUsageWindows(limits);
  const balanceData = balance === null ? null : ClineBalanceSchema.safeParse(balance);
  const creditBalance =
    balanceData?.success === true ? balanceFromRaw(balanceData.data.balance) : null;
  if (windows[0]) windows[0].headline = true;

  return {
    status: "available",
    planLabel,
    windows,
    balances: creditBalance ? [creditBalance] : [],
    details: [],
  };
}

export async function fetchUsage(
  input: UsageInput,
  fetchApi: typeof fetch = fetch,
): Promise<UsageReport> {
  void input;
  const credentials = await readCredentials();
  if (credentials.length === 0) return unavailableUsage();

  for (const credential of credentials) {
    const usage = await fetchUsageWithCredential(fetchApi, credential);
    // Null means this credential was rejected; try the next Cline login.
    if (usage) return usage;
  }
  return unavailableUsage();
}

export async function identify() {
  const credentials = await readCredentials();
  return credentials.length > 0 ? { key: "default" } : null;
}
