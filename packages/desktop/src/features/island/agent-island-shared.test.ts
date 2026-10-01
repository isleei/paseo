import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  applyAgentIslandEvent,
  applyAgentIslandInteractionRequest,
  buildAgentMenuBarState,
  createAgentIslandState,
  acknowledgeAgentIslandSessionRead,
} from "./state.js";

describe("Mac menu bar tasks", () => {
  it("shows running, waiting and finished tasks together without selecting an automatic overlay", () => {
    const state = createAgentIslandState();
    for (const sessionId of ["running", "waiting", "finished"]) {
      applyAgentIslandEvent(
        state,
        { sessionId },
        { type: "status", data: { isRunning: true } },
        1000,
      );
    }
    applyAgentIslandInteractionRequest(
      state,
      { sessionId: "waiting" },
      {
        kind: "permission",
        requestId: "request",
        toolName: "Bash",
        input: { command: "ls" },
      },
      1100,
    );
    applyAgentIslandEvent(state, { sessionId: "finished" }, { type: "done", data: {} }, 1200);
    const display = buildAgentMenuBarState(state, 1300);
    expect(display.sessions.map((s) => [s.sessionId, s.phase])).toEqual([
      ["waiting", "needs-interaction"],
      ["running", "running"],
      ["finished", "completed"],
    ]);
    expect(display).not.toHaveProperty("mode");
    expect(display).not.toHaveProperty("frames");
    expect(display.mascotSkin).toBe("paimon");
  });

  it("keeps unread results until acknowledged and publishes an empty idle entry", () => {
    const state = createAgentIslandState();
    const meta = { sessionId: "done" };
    applyAgentIslandEvent(state, meta, { type: "status", data: { isRunning: true } }, 1000);
    applyAgentIslandEvent(state, meta, { type: "done", data: {} }, 2000);
    expect(buildAgentMenuBarState(state, 20_000).sessions).toHaveLength(1);
    acknowledgeAgentIslandSessionRead(state, "done", 20_000);
    expect(buildAgentMenuBarState(state, 20_001).sessions).toEqual([]);
  });

  it.skipIf(process.platform !== "darwin")(
    "uses one click-open native status item, without a notch window",
    () => {
      const directory = mkdtempSync(path.join(tmpdir(), "paseo-menu-bar-"));
      try {
        const helper = readFileSync(
          new URL("../../../native/agent-island/macos-agent-island-helper.swift", import.meta.url),
          "utf8",
        );
        const harness = readFileSync(
          new URL("./fixtures/menu-bar-regression.swift", import.meta.url),
          "utf8",
        );
        const bootstrap = helper.lastIndexOf("\nlet app = NSApplication.shared");
        expect(bootstrap).toBeGreaterThan(0);
        const source = path.join(directory, "main.swift");
        const executable = path.join(directory, "check");
        writeFileSync(source, helper.slice(0, bootstrap) + "\n" + harness);
        execFileSync("swiftc", [source, "-o", executable], { timeout: 60_000 });
        expect(
          execFileSync(executable, {
            encoding: "utf8",
            timeout: 15_000,
            env: {
              ...process.env,
              XDT_AGENT_ISLAND_ASSET_DIR: path.resolve("packages/desktop/native/agent-island"),
            },
          }),
        ).toContain("PASS:");
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
    80_000,
  );
});
