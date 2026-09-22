import { describe, expect, it } from "vitest";
import { toBranchName } from "./git";

describe("task worktree branches", () => {
  it("uses a distinct branch for every execution", () => {
    expect(toBranchName("Review release", "task_abcdef", 1)).toBe("tasks/review-release-abcdef-r1");
    expect(toBranchName("Review release", "task_abcdef", 2)).toBe("tasks/review-release-abcdef-r2");
  });
});
