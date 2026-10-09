import type { TFunction } from "i18next";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { deriveProjectDisplayName, deriveProjectKey } from "@/utils/agent-grouping";

export const ALL_PROJECTS_OPTION_ID = "all";

export interface SessionProjectOption {
  /** Stable identity used for filtering; never the display label. */
  projectKey: string;
  label: string;
  /** Newest session in this project; orders the dropdown. */
  lastActivityAt: Date;
}

/**
 * Same identity rule as the sidebar grouping: the daemon's remote-first
 * placement key when present, the cwd-derived key otherwise.
 */
export function sessionProjectKey(agent: AggregatedAgent): string {
  return agent.projectPlacement?.projectKey ?? deriveProjectKey(agent.cwd);
}

/**
 * One option per project, deduplicated by key and ordered by most recent
 * session activity. Only projects in the already-loaded history pages appear.
 */
export function buildSessionProjectOptions(agents: AggregatedAgent[]): SessionProjectOption[] {
  const byKey = new Map<string, SessionProjectOption>();
  for (const agent of agents) {
    const projectKey = sessionProjectKey(agent);
    if (!projectKey) {
      continue;
    }
    const existing = byKey.get(projectKey);
    if (existing && existing.lastActivityAt.getTime() >= agent.lastActivityAt.getTime()) {
      continue;
    }
    byKey.set(projectKey, {
      projectKey,
      label: deriveProjectDisplayName({
        projectKey,
        projectName: agent.projectPlacement?.projectName ?? "",
      }),
      lastActivityAt: agent.lastActivityAt,
    });
  }
  return [...byKey.values()].sort(
    (a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime(),
  );
}

/** "all" returns the input array unchanged so memoized callers keep identity. */
export function filterAgentsByProject(
  agents: AggregatedAgent[],
  projectKey: string,
): AggregatedAgent[] {
  if (projectKey === ALL_PROJECTS_OPTION_ID) {
    return agents;
  }
  return agents.filter((agent) => sessionProjectKey(agent) === projectKey);
}

/**
 * Trigger label for a key that may no longer appear in the loaded pages —
 * rebuilt from the key itself so the control never falls back to a raw id.
 */
export function sessionProjectLabel(projectKey: string): string {
  if (projectKey === ALL_PROJECTS_OPTION_ID) {
    return "";
  }
  return deriveProjectDisplayName({ projectKey, projectName: "" });
}

/**
 * Which archived state the History list is narrowed to. The daemon answers one
 * page holding both archived and live sessions, so this is a view filter over
 * the rows the screen already has rather than a change to the query.
 */
export type SessionsArchivedFilter = "all" | "active" | "archived";

/** `all` returns the caller's array so the list keeps its identity at rest. */
export function filterAgentsByArchivedState(
  agents: AggregatedAgent[],
  filter: SessionsArchivedFilter,
): AggregatedAgent[] {
  if (filter === "all") {
    return agents;
  }
  return agents.filter((agent) =>
    filter === "archived" ? Boolean(agent.archivedAt) : !agent.archivedAt,
  );
}

/** An empty list means something different once a query or a filter narrows it. */
export function resolveSessionsEmptyText(input: {
  t: TFunction;
  isSearching: boolean;
  isAllHosts: boolean;
  archivedFilter: SessionsArchivedFilter;
  projectFilter: string;
  projectLabel: string;
  /**
   * Later pages exist. A filter-specific message claims that kind is empty,
   * which the loaded page cannot support while more rows are still unfetched.
   */
  hasMore: boolean;
}): string {
  if (input.isSearching) {
    return input.t("sessions.noMatches");
  }
  if (input.projectFilter !== ALL_PROJECTS_OPTION_ID) {
    return input.t("sessions.projectFilter.emptyFiltered", { project: input.projectLabel });
  }
  if (input.archivedFilter === "archived") {
    return input.hasMore
      ? input.t("sessions.archivedFilter.emptyLoaded")
      : input.t("sessions.archivedFilter.emptyArchived");
  }
  if (input.archivedFilter === "active") {
    return input.hasMore
      ? input.t("sessions.archivedFilter.emptyLoaded")
      : input.t("sessions.archivedFilter.emptyActive");
  }
  if (input.isAllHosts) {
    return input.t("sessions.empty");
  }
  return "No sessions for this host";
}
