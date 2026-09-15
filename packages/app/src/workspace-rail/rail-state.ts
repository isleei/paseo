import { z } from "zod";
import type { ToolCallDetail } from "@getpaseo/protocol/agent-types";
import type { CheckoutStatusPayload } from "@/git/use-status-query";
import { isAgentToolCallItem, type StreamItem, type TodoEntry } from "@/types/stream";

/**
 * The rail's sections, in the order they stack.
 *
 * These ids are persisted, so renaming one silently reopens a section the user had collapsed.
 */
export const RAIL_SECTION_IDS = [
  "tasks",
  "changes",
  "artifacts",
  "sources",
  "skills",
  "environment",
  "commits",
  "subagents",
] as const;

export type RailSectionId = (typeof RAIL_SECTION_IDS)[number];

/**
 * Which sections have anything to show.
 *
 * The rail answers this for the sections it can see whole, rather than letting each one opt out,
 * because the sections are separated by rules: a section that returns null after the divider has
 * already been drawn leaves a stray line across the panel.
 *
 * 子代理 is missing on purpose. Its rows come from a hook that needs a parent agent, so it cannot
 * be asked before the rail knows the active tab — it renders itself and draws its own rule.
 */
export const RAIL_DECIDED_SECTION_IDS = [
  "tasks",
  "changes",
  "artifacts",
  "sources",
  "skills",
  "environment",
  "commits",
] as const;

export type RailDecidedSectionId = (typeof RAIL_DECIDED_SECTION_IDS)[number];

export interface RailSectionsInput {
  taskCount: number;
  changeCount: number;
  artifactCount: number;
  sourceCount: number;
  skillCount: number;
  isGit: boolean;
  commitCount: number;
}

export function selectRailSections(input: RailSectionsInput): RailDecidedSectionId[] {
  return RAIL_DECIDED_SECTION_IDS.filter((id) => {
    switch (id) {
      case "tasks":
        return input.taskCount > 0;
      case "changes":
        return input.isGit && input.changeCount > 0;
      case "artifacts":
        return input.artifactCount > 0;
      case "sources":
        return input.sourceCount > 0;
      case "skills":
        return input.skillCount > 0;
      case "environment":
        return input.isGit;
      case "commits":
        return input.commitCount > 0;
    }
  });
}

export interface PersistedWorkspaceRail {
  collapsed?: boolean;
  closedSections?: RailSectionId[];
}

export const PersistedWorkspaceRailSchema: z.ZodType<PersistedWorkspaceRail> = z.strictObject({
  collapsed: z.boolean().optional(),
  closedSections: z.array(z.enum(RAIL_SECTION_IDS)).optional(),
});

export interface RailGitState {
  branch: string | null;
  isDirty: boolean;
  ahead: number | null;
  behind: number | null;
  hasRemote: boolean;
}

/** Null when the checkout is not a git repo, which leaves the environment section with nothing to say. */
export function deriveRailGitState(status: CheckoutStatusPayload | null): RailGitState | null {
  if (status?.isGit !== true) {
    return null;
  }
  return {
    branch: status.currentBranch ?? null,
    isDirty: status.isDirty === true,
    ahead: status.aheadOfOrigin ?? null,
    behind: status.behindOfOrigin ?? null,
    hasRemote: status.hasRemote,
  };
}

/**
 * `↑2 ↓1`, dropping each half when it is zero. Null when the branch tracks nothing — a branch with
 * no upstream and one that is level with its upstream both mean "nothing to do here".
 */
export function formatUpstreamDelta(state: RailGitState): string | null {
  const parts: string[] = [];
  if (state.ahead) parts.push(`↑${state.ahead}`);
  if (state.behind) parts.push(`↓${state.behind}`);
  return parts.length > 0 ? parts.join(" ") : null;
}

/**
 * `+174 −21`, dropping each half when it is zero.
 *
 * The minus sign is U+2212, not a hyphen: a hyphen next to digits reads as part of the number in
 * the same muted run, and the two counts need to look like one figure the eye can split.
 */
export function formatDiffStat(
  diffStat: { additions: number; deletions: number } | null | undefined,
): string | null {
  if (!diffStat || (diffStat.additions === 0 && diffStat.deletions === 0)) {
    return null;
  }
  const parts: string[] = [];
  if (diffStat.additions > 0) parts.push(`+${diffStat.additions}`);
  if (diffStat.deletions > 0) parts.push(`−${diffStat.deletions}`);
  return parts.join(" ");
}

export interface RailTaskProgress {
  completed: number;
  total: number;
}

export function countCompletedTasks(tasks: readonly TodoEntry[]): RailTaskProgress {
  return {
    completed: tasks.filter((task) => task.completed || task.status === "completed").length,
    total: tasks.length,
  };
}

export function isSectionOpen(
  closedSections: readonly RailSectionId[],
  id: RailSectionId,
): boolean {
  return !closedSections.includes(id);
}

export function toggleSectionId(
  closedSections: readonly RailSectionId[],
  id: RailSectionId,
): RailSectionId[] {
  return closedSections.includes(id)
    ? closedSections.filter((candidate) => candidate !== id)
    : [...closedSections, id];
}

export interface RailArtifact {
  path: string;
  /** `produced` is a file the session created; `intermediate` is one it edited in place. */
  kind: "produced" | "intermediate";
}

export interface RailWebSource {
  label: string;
  url: string | null;
}

export interface RailSkillUse {
  name: string;
  count: number;
}

export interface RailSessionDerived {
  artifacts: RailArtifact[];
  webSources: RailWebSource[];
  projectFiles: string[];
  skills: RailSkillUse[];
}

/**
 * What a session produced and leaned on, read out of its timeline.
 *
 * One reverse pass, newest first, because every list here is "what did this session touch lately"
 * and the newest entry is the one the eye looks for. Each list is capped: the rail is a summary,
 * and a session that read four hundred files would otherwise bury the section under it.
 *
 * The three lists are derived together rather than by three hooks so the timeline is walked once
 * per render, not three times.
 */
export const MAX_RAIL_ARTIFACTS = 10;
export const MAX_RAIL_WEB_SOURCES = 6;
export const MAX_RAIL_PROJECT_FILES = 6;
export const MAX_RAIL_SKILLS = 8;

export function deriveRailSessionDerived(items: readonly StreamItem[]): RailSessionDerived {
  const artifacts: RailArtifact[] = [];
  const webSources: RailWebSource[] = [];
  const projectFiles: string[] = [];
  const skillCounts = new Map<string, number>();
  const seenArtifactPaths = new Set<string>();
  const seenProjectPaths = new Set<string>();

  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (!item || !isAgentToolCallItem(item)) {
      continue;
    }
    const { name, detail } = item.payload.data;

    if (isSkillToolName(name)) {
      const skillName = skillNameFor(detail, name);
      if (skillName) {
        skillCounts.set(skillName, (skillCounts.get(skillName) ?? 0) + 1);
      }
      continue;
    }

    switch (detail.type) {
      case "write": {
        pushArtifact(artifacts, seenArtifactPaths, detail.filePath, "produced");
        break;
      }
      case "edit": {
        pushArtifact(artifacts, seenArtifactPaths, detail.filePath, "intermediate");
        break;
      }
      case "read": {
        pushUnique(projectFiles, seenProjectPaths, detail.filePath, MAX_RAIL_PROJECT_FILES);
        break;
      }
      case "search": {
        for (const result of detail.webResults ?? []) {
          upsertWebSource(webSources, {
            label: result.title.trim() || result.url,
            url: result.url,
          });
        }
        break;
      }
      case "fetch": {
        upsertWebSource(webSources, { label: detail.url, url: detail.url });
        break;
      }
      default:
        break;
    }
  }

  const skills = [...skillCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name))
    .slice(0, MAX_RAIL_SKILLS);

  return { artifacts, webSources, projectFiles, skills };
}

/** Providers spell the skill tool as `Skill`; the comparison is case-insensitive for the rest. */
function isSkillToolName(name: string): boolean {
  return name.trim().toLowerCase() === "skill";
}

/**
 * Claude's parser turns a skill call into `plain_text` carrying the skill's name as its label; any
 * other provider that reports a skill tool keeps the name, so the label is preferred only when the
 * detail actually carries one.
 */
function skillNameFor(detail: ToolCallDetail, fallback: string): string {
  if (detail.type === "plain_text") {
    const label = detail.label?.trim();
    if (label) return label;
  }
  return fallback.trim();
}

function pushArtifact(
  artifacts: RailArtifact[],
  seen: Set<string>,
  path: string,
  kind: RailArtifact["kind"],
): void {
  const trimmed = path.trim();
  if (!trimmed || seen.has(trimmed) || artifacts.length >= MAX_RAIL_ARTIFACTS) {
    return;
  }
  seen.add(trimmed);
  artifacts.push({ path: trimmed, kind });
}

function pushUnique<T>(
  target: T[],
  seen: Set<string>,
  value: T,
  limit: number,
  keyOf: (entry: T) => string = (entry) => String(entry),
): void {
  const key = keyOf(value);
  if (!key || seen.has(key) || target.length >= limit) {
    return;
  }
  seen.add(key);
  target.push(value);
}

/**
 * Adds a link, or titles one already in the list.
 *
 * A fetch only knows the URL while a search result carries the page's title, and both can name the
 * same page. The title reads better, so whichever entry arrives second upgrades a bare URL rather
 * than adding a duplicate row beside it.
 */
function upsertWebSource(sources: RailWebSource[], next: RailWebSource): void {
  const key = next.url ?? next.label;
  if (!key) return;
  const existingIndex = sources.findIndex((source) => (source.url ?? source.label) === key);
  if (existingIndex >= 0) {
    const existing = sources[existingIndex];
    if (existing?.url && existing.label === existing.url && next.label !== next.url) {
      sources[existingIndex] = next;
    }
    return;
  }
  if (sources.length < MAX_RAIL_WEB_SOURCES) {
    sources.push(next);
  }
}
