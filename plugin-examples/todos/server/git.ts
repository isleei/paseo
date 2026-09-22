import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Returns the repo toplevel when cwd lives inside a git checkout, else null.
// Used to decide between an isolated worktree branch-off and a plain
// same-directory workspace.
export async function findRepoRoot(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", cwd, "rev-parse", "--show-toplevel"]);
    const root = stdout.trim();
    return root === "" ? null : root;
  } catch {
    return null;
  }
}

// Deterministic, collision-resistant branch name. Non-latin titles collapse
// to "task"; the id suffix keeps it unique.
export function toBranchName(title: string, id: string, runNumber: number): string {
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "task";
  const short = id.replace(/[^a-z0-9]/gi, "").slice(-6) || "todo";
  return `tasks/${slug}-${short}-r${runNumber}`;
}
