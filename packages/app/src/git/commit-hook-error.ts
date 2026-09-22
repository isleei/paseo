export function isPreCommitHookError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("hook: pre-commit") ||
    lower.includes("pre-commit") ||
    lower.includes("lefthook") ||
    lower.includes("husky") ||
    lower.includes("commit-msg hook failed") ||
    lower.includes(".git/hooks/pre-commit")
  );
}
