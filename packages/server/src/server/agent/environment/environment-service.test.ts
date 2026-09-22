import { describe, expect, test } from "vitest";
import {
  buildBinaryUpgradeHint,
  buildNpmUpgradeCommand,
  resolveKnownNpmPackage,
  resolveNpmPackageName,
} from "./environment-service.js";

describe("resolveNpmPackageName", () => {
  test("extracts the package from an npx launch with flags", () => {
    expect(resolveNpmPackageName(["-y", "@google/gemini-cli@0.52.0", "--acp"])).toBe(
      "@google/gemini-cli",
    );
  });

  test("strips a version spec from an unscoped package", () => {
    expect(resolveNpmPackageName(["opencode-ai@1.2.3"])).toBe("opencode-ai");
  });

  test("keeps a scoped package without a version", () => {
    expect(resolveNpmPackageName(["@anthropic-ai/claude-code"])).toBe("@anthropic-ai/claude-code");
  });

  test("supports pnpm dlx shape", () => {
    expect(resolveNpmPackageName(["dlx", "@anthropic-ai/claude-code@latest"])).toBe(
      "@anthropic-ai/claude-code",
    );
  });

  test("supports --package flag", () => {
    expect(resolveNpmPackageName(["--package", "grok-cli@0.2.11", "grok"])).toBe("grok-cli");
  });

  test("returns null when only flags are present", () => {
    expect(resolveNpmPackageName(["-y", "--silent"])).toBeNull();
  });

  test("returns null for empty args", () => {
    expect(resolveNpmPackageName([])).toBeNull();
  });
});

describe("resolveKnownNpmPackage", () => {
  test("maps verified builtin providers to their npm packages", () => {
    expect(resolveKnownNpmPackage("claude")).toBe("@anthropic-ai/claude-code");
    expect(resolveKnownNpmPackage("codex")).toBe("@openai/codex");
    expect(resolveKnownNpmPackage("opencode")).toBe("opencode-ai");
    expect(resolveKnownNpmPackage("gemini")).toBe("@google/gemini-cli");
    expect(resolveKnownNpmPackage("copilot")).toBe("@github/copilot");
  });

  test("returns null for providers without a verified package", () => {
    expect(resolveKnownNpmPackage("pi")).toBeNull();
    expect(resolveKnownNpmPackage("grok")).toBeNull();
  });
});

describe("buildNpmUpgradeCommand", () => {
  test("pins latest explicitly", () => {
    expect(buildNpmUpgradeCommand("opencode-ai")).toBe("npm install -g opencode-ai@latest");
  });
});

describe("buildBinaryUpgradeHint", () => {
  test("suggests the manual command when a binary install lags npm", () => {
    expect(
      buildBinaryUpgradeHint(
        { channel: "binary", packageName: "opencode-ai" },
        "1.18.30",
        "1.18.31",
      ),
    ).toBe("npm install -g opencode-ai@latest");
  });

  test("returns null for npm channels, current versions, and unknown packages", () => {
    expect(
      buildBinaryUpgradeHint({ channel: "npm", packageName: "opencode-ai" }, "1.18.30", "1.18.31"),
    ).toBeNull();
    expect(
      buildBinaryUpgradeHint(
        { channel: "binary", packageName: "opencode-ai" },
        "1.18.31",
        "1.18.31",
      ),
    ).toBeNull();
    expect(
      buildBinaryUpgradeHint({ channel: "binary", packageName: null }, "1.0.0", "2.0.0"),
    ).toBeNull();
    expect(
      buildBinaryUpgradeHint({ channel: "binary", packageName: "opencode-ai" }, null, "1.18.31"),
    ).toBeNull();
  });
});
