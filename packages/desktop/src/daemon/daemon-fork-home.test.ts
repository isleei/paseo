import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ensureForkListenDefault, getPaseoHome } from "./daemon-manager.js";

vi.mock("electron", () => ({
  app: {},
  ipcMain: { handle: vi.fn() },
  powerMonitor: {},
}));

vi.mock("electron-log/main", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe("fork daemon home", () => {
  const originalHome = process.env.HOME;
  const originalPaseoHome = process.env.PASEO_HOME;
  let fixtureRoot: string;

  beforeEach(() => {
    fixtureRoot = mkdtempSync(path.join(tmpdir(), "paimon fork home "));
    process.env.HOME = fixtureRoot;
    delete process.env.PASEO_HOME;
  });

  afterEach(() => {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    if (originalPaseoHome === undefined) {
      delete process.env.PASEO_HOME;
    } else {
      process.env.PASEO_HOME = originalPaseoHome;
    }
    rmSync(fixtureRoot, { recursive: true, force: true });
  });

  it("prefers explicit PASEO_HOME over the fork default", () => {
    process.env.PASEO_HOME = path.join(fixtureRoot, "custom-home");
    expect(getPaseoHome()).toBe(path.join(fixtureRoot, "custom-home"));
  });

  it("defaults to ~/.paimon instead of sharing ~/.paseo", () => {
    expect(homedir()).toBe(fixtureRoot);
    expect(getPaseoHome()).toBe(path.join(fixtureRoot, ".paimon"));
  });

  it("seeds 6769 on a fresh fork home", () => {
    const home = path.join(fixtureRoot, ".paimon");
    ensureForkListenDefault(home);
    const saved = JSON.parse(readFileSync(path.join(home, "config.json"), "utf-8")) as {
      daemon?: { listen?: unknown };
    };
    expect(saved.daemon?.listen).toBe("127.0.0.1:6769");
  });

  it("seeds 6769 when the fork config has no listen address", () => {
    const home = path.join(fixtureRoot, ".paimon");
    ensureForkListenDefault(home);
    const configPath = path.join(home, "config.json");
    const saved = JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>;
    delete (saved.daemon as Record<string, unknown>)?.listen;
    writeFileSync(configPath, JSON.stringify(saved));
    ensureForkListenDefault(home);
    const reseeded = JSON.parse(readFileSync(configPath, "utf-8")) as {
      daemon?: { listen?: unknown };
    };
    expect(reseeded.daemon?.listen).toBe("127.0.0.1:6769");
  });

  it("leaves fork homes with an explicit listen alone", () => {
    const home = path.join(fixtureRoot, ".paimon");
    ensureForkListenDefault(home);
    const configPath = path.join(home, "config.json");
    const saved = JSON.parse(readFileSync(configPath, "utf-8")) as {
      daemon?: Record<string, unknown>;
    };
    saved.daemon = { ...saved.daemon, listen: "127.0.0.1:6777" };
    writeFileSync(configPath, JSON.stringify(saved));
    ensureForkListenDefault(home);
    const kept = JSON.parse(readFileSync(configPath, "utf-8")) as {
      daemon?: { listen?: unknown };
    };
    expect(kept.daemon?.listen).toBe("127.0.0.1:6777");
  });

  it("leaves non-fork homes alone", () => {
    const home = path.join(fixtureRoot, "other-home");
    ensureForkListenDefault(home);
    expect(() => readFileSync(path.join(home, "config.json"), "utf-8")).toThrow();
  });
});
