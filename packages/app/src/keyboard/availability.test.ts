import { describe, expect, it } from "vitest";
import { keyboardShortcutsAvailable } from "./availability";

describe("keyboardShortcutsAvailable", () => {
  it("matches the environments where the shortcut dispatcher runs", () => {
    expect(keyboardShortcutsAvailable({ isNative: false, isCompact: false })).toBe(true);
    expect(keyboardShortcutsAvailable({ isNative: false, isCompact: true })).toBe(false);
    expect(keyboardShortcutsAvailable({ isNative: true, isCompact: false })).toBe(false);
    expect(keyboardShortcutsAvailable({ isNative: true, isCompact: true })).toBe(false);
  });

  it.each([false, true])("keeps Electron shortcuts available with compact=%s", (isCompact) => {
    expect(keyboardShortcutsAvailable({ isNative: false, isCompact, isElectron: true })).toBe(true);
  });
});
