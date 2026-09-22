import { describe, expect, it } from "vitest";
import { isPreCommitHookError } from "./commit-hook-error";

describe("isPreCommitHookError", () => {
  it("detects lefthook pre-commit failure message", () => {
    const error =
      "Git command failed: git commit -m Refine (exit code: 1, signal: none)\n" +
      "🥊 lefthook v2.1.6  hook: pre-commit\n" +
      "oxfmt --check packages/app/src/input.tsx";
    expect(isPreCommitHookError(error)).toBe(true);
  });

  it("detects husky pre-commit failure message", () => {
    const error = "husky - pre-commit hook exited with code 1 (error)";
    expect(isPreCommitHookError(error)).toBe(true);
  });

  it("detects generic pre-commit hook failure message", () => {
    const error = "pre-commit hook failed (add --no-verify to bypass)";
    expect(isPreCommitHookError(error)).toBe(true);
  });

  it("does not trigger on ordinary git errors", () => {
    expect(isPreCommitHookError("nothing to commit, working tree clean")).toBe(false);
    expect(isPreCommitHookError("fatal: not a git repository")).toBe(false);
    expect(
      isPreCommitHookError("error: pathspec 'foo' did not match any file(s) known to git"),
    ).toBe(false);
  });
});
