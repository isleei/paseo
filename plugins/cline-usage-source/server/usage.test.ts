import { mkdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchUsage, identify } from "./usage.js";

function writeClineProviders(
  home: string,
  entries: Record<string, { token: string; userId?: string | null }>,
): void {
  const dir = join(home, ".cline", "data", "settings");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "providers.json"),
    JSON.stringify({
      version: 1,
      providers: Object.fromEntries(
        Object.entries(entries).map(([name, entry]) => [
          name,
          {
            settings: {
              provider: name,
              auth: {
                accessToken: entry.token,
                refreshToken: "rt_cline",
                expiresAt: 1_798_812_800_000,
                metadata: {
                  userInfo: {
                    clineUserId: entry.userId ?? null,
                    email: "user@example.com",
                  },
                },
              },
            },
            updatedAt: "2026-06-19T00:00:00.000Z",
          },
        ]),
      ),
    }),
  );
}

function clineEnvelope(data: unknown): Record<string, unknown> {
  return { success: true, data };
}

function mockFetch(handlers: Map<string, () => Response>): typeof fetch {
  return vi.fn(async (url: RequestInfo | URL) => {
    const key = url.toString();
    const handler = handlers.get(key);
    if (!handler) throw new Error(`Unmocked fetch: ${key}`);
    return handler();
  }) as unknown as typeof fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("cline usage source", () => {
  let homeDir: string;
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), "cline-usage-home-"));
    originalEnv = { ...process.env };
    process.env["HOME"] = homeDir;
    process.env["USERPROFILE"] = homeDir;
    delete process.env["CLINE_API_KEY"];
    delete process.env["CLINE_TOKEN"];
  });

  afterEach(() => {
    rmSync(homeDir, { recursive: true, force: true });
    for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
    for (const key in originalEnv) process.env[key] = originalEnv[key];
  });

  it("fetches ClinePass windows, credit balance, and plan label", async () => {
    writeClineProviders(homeDir, {
      "cline-pass": { token: "cline_test_token", userId: "usr-1" },
    });
    const fetchApi = mockFetch(
      new Map([
        [
          "https://api.cline.bot/api/v1/users/me/plan",
          () =>
            jsonResponse(
              clineEnvelope({
                plan: { id: "plan-pass", name: "ClinePass", displayName: "ClinePass" },
              }),
            ),
        ],
        [
          "https://api.cline.bot/api/v1/users/me/plan/usage-limits",
          () =>
            jsonResponse(
              clineEnvelope({
                limits: [
                  { type: "five_hour", percentUsed: 20, resetsAt: "2026-06-19T05:00:00Z" },
                  { type: "weekly", percentUsed: 65, resetsAt: "2026-06-22T00:00:00Z" },
                  { type: "monthly", percentUsed: 10, resetsAt: "2026-07-01T00:00:00Z" },
                ],
              }),
            ),
        ],
        [
          "https://api.cline.bot/api/v1/users/usr-1/balance",
          () => jsonResponse(clineEnvelope({ userId: "usr-1", balance: 500000 })),
        ],
      ]),
    );

    await expect(fetchUsage({}, fetchApi)).resolves.toMatchObject({
      status: "available",
      planLabel: "ClinePass",
      windows: [
        {
          id: "five_hour",
          label: "5-hour",
          usedPct: 20,
          remainingPct: 80,
          resetsAt: "2026-06-19T05:00:00Z",
          tone: "ok",
          headline: true,
        },
        {
          id: "weekly",
          label: "Weekly",
          usedPct: 65,
          remainingPct: 35,
          resetsAt: "2026-06-22T00:00:00Z",
          tone: "ok",
        },
        {
          id: "monthly",
          label: "Monthly",
          usedPct: 10,
          remainingPct: 90,
          resetsAt: "2026-07-01T00:00:00Z",
          tone: "ok",
        },
      ],
      balances: [
        expect.objectContaining({
          id: "credits",
          remaining: 0.5,
          unit: "usd",
        }),
      ],
    });
    await expect(identify()).resolves.toEqual({ key: "default" });
  });

  it("fetches Cline balance through /users/me when the file has no user id", async () => {
    process.env["CLINE_API_KEY"] = "cline_env_token";
    const fetchApi = mockFetch(
      new Map([
        ["https://api.cline.bot/api/v1/users/me/plan", () => jsonResponse(clineEnvelope(null))],
        [
          "https://api.cline.bot/api/v1/users/me/plan/usage-limits",
          () => jsonResponse(clineEnvelope(null)),
        ],
        [
          "https://api.cline.bot/api/v1/users/me",
          () => jsonResponse(clineEnvelope({ id: "usr-9" })),
        ],
        [
          "https://api.cline.bot/api/v1/users/usr-9/balance",
          () => jsonResponse(clineEnvelope({ userId: "usr-9", balance: 2500000 })),
        ],
      ]),
    );

    await expect(fetchUsage({}, fetchApi)).resolves.toMatchObject({
      status: "available",
      windows: [],
      balances: [expect.objectContaining({ id: "credits", remaining: 2.5, unit: "usd" })],
    });
  });

  it("stays available with balance only when there is no ClinePass subscription", async () => {
    writeClineProviders(homeDir, {
      cline: { token: "cline_test_token", userId: "usr-1" },
    });
    const fetchApi = mockFetch(
      new Map([
        ["https://api.cline.bot/api/v1/users/me/plan", () => jsonResponse(clineEnvelope(null))],
        [
          "https://api.cline.bot/api/v1/users/me/plan/usage-limits",
          () => jsonResponse(clineEnvelope(null)),
        ],
        [
          "https://api.cline.bot/api/v1/users/usr-1/balance",
          () => jsonResponse(clineEnvelope({ userId: "usr-1", balance: 1000000 })),
        ],
      ]),
    );

    await expect(fetchUsage({}, fetchApi)).resolves.toMatchObject({
      status: "available",
      windows: [],
      balances: [expect.objectContaining({ remaining: 1 })],
    });
  });

  it("skips malformed Cline usage-limit windows", async () => {
    writeClineProviders(homeDir, {
      "cline-pass": { token: "cline_test_token", userId: "usr-1" },
    });
    const fetchApi = mockFetch(
      new Map([
        [
          "https://api.cline.bot/api/v1/users/me/plan",
          () => jsonResponse(clineEnvelope({ plan: { name: "ClinePass" } })),
        ],
        [
          "https://api.cline.bot/api/v1/users/me/plan/usage-limits",
          () =>
            jsonResponse(
              clineEnvelope({
                limits: [
                  { type: "weekly", percentUsed: 40 },
                  { type: "monthly", percentUsed: "not-a-number" },
                  "garbage",
                ],
              }),
            ),
        ],
        [
          "https://api.cline.bot/api/v1/users/usr-1/balance",
          () => jsonResponse(clineEnvelope({ userId: "usr-1", balance: 0 })),
        ],
      ]),
    );

    const report = await fetchUsage({}, fetchApi);
    expect(report.windows.map((window) => window.id)).toEqual(["weekly"]);
    expect(report).toMatchObject({ status: "available" });
  });

  it("returns unavailable Cline usage on 401 without refreshing or rewriting providers.json", async () => {
    writeClineProviders(homeDir, {
      cline: { token: "expired_token", userId: "usr-1" },
    });
    const providersPath = join(homeDir, ".cline", "data", "settings", "providers.json");
    const before = readFileSync(providersPath, "utf8");
    const fetchApi = mockFetch(
      new Map([
        ["https://api.cline.bot/api/v1/users/me/plan", () => jsonResponse({}, 401)],
        ["https://api.cline.bot/api/v1/users/me/plan/usage-limits", () => jsonResponse({}, 401)],
        ["https://api.cline.bot/api/v1/users/usr-1/balance", () => jsonResponse({}, 401)],
      ]),
    );

    await expect(fetchUsage({}, fetchApi)).resolves.toMatchObject({
      status: "unavailable",
      windows: [],
      balances: [],
    });
    expect(readFileSync(providersPath, "utf8")).toBe(before);
  });

  it("returns unavailable Cline usage when credentials are missing", async () => {
    await expect(fetchUsage({}, mockFetch(new Map()))).resolves.toMatchObject({
      status: "unavailable",
      windows: [],
      balances: [],
    });
    await expect(identify()).resolves.toBeNull();
  });

  it("tries the freshest Cline login first", async () => {
    const dir = join(homeDir, ".cline", "data", "settings");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "providers.json"),
      JSON.stringify({
        providers: {
          cline: {
            settings: {
              auth: { accessToken: "stale_token", expiresAt: 1_700_000_000_000 },
            },
          },
          "cline-pass": {
            settings: {
              auth: {
                accessToken: "fresh_token",
                expiresAt: 1_798_812_800_000,
                metadata: { userInfo: { clineUserId: "usr-1" } },
              },
            },
          },
        },
      }),
    );
    const authorizations: Array<string | null> = [];
    const fetchApi = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      authorizations.push(
        (init?.headers as Record<string, string> | undefined)?.Authorization ?? null,
      );
      return jsonResponse(clineEnvelope(null));
    }) as unknown as typeof fetch;

    await fetchUsage({}, fetchApi);

    expect(authorizations[0]).toBe("Bearer fresh_token");
  });
});
