/**
 * Paseo port: single-line tool status copy for the island.
 * Cindy rendered this via maker-shared message-presentation; Paseo inlines a
 * minimal version (command + description) so the island has no cross-repo deps.
 */

const ISLAND_DETAIL_MAX_CHARS = 80;

export interface IslandToolRowWording {
  running: string;
}

export interface IslandToolDetailOptions {
  wording: IslandToolRowWording;
  requireCommandVisible?: boolean;
}

export function formatIslandToolDetail(
  toolName: string,
  input: unknown,
  options: IslandToolDetailOptions,
  fallback?: Record<string, unknown>,
): string | null {
  const toolInput = asRecord(input);
  if (!toolInput) {
    return firstNonEmptyString(
      fallback?.description,
      fallback?.toolDescription,
      fallback?.displayName,
    );
  }
  const question = permissionQuestionDetail(toolInput);
  if (question) return question;
  const command = firstNonEmptyString(toolInput.command, toolInput.cmd, toolInput.code);
  const description = firstNonEmptyString(
    toolInput.description,
    toolInput.message,
    toolInput.toolTitle,
    toolInput.toolDescription,
    fallback?.description,
  );
  if (description && command) {
    if (description === command || description.includes(command)) return truncate(description);
    return truncate(`${description} · $ ${command}`);
  }
  if (description) return truncate(description);
  if (command) return truncate(`$ ${command}`);
  const trimmedName = toolName.trim();
  if (trimmedName) return truncate(`${options.wording.running} ${trimmedName}`);
  return null;
}

function permissionQuestionDetail(input: Record<string, unknown>): string | null {
  const questions = input.questions;
  if (!Array.isArray(questions)) return null;
  const firstQuestion = questions.find(
    (question): question is Record<string, unknown> =>
      Boolean(question) && typeof question === "object" && !Array.isArray(question),
  );
  if (!firstQuestion) return null;
  const text = firstNonEmptyString(firstQuestion.question, firstQuestion.header);
  if (!text) return null;
  const extraCount = questions.length - 1;
  return extraCount > 0 ? `${text} (+${extraCount})` : text;
}

function truncate(text: string): string {
  if (text.length <= ISLAND_DETAIL_MAX_CHARS) return text;
  return `${text.slice(0, ISLAND_DETAIL_MAX_CHARS - 1)}…`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function firstNonEmptyString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return null;
}
