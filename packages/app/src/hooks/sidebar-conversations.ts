import { isWorkspaceRootAgent } from "@/subagents/policies";
import { deriveProjectKey, deriveProjectName } from "@/utils/agent-grouping";
import { normalizeWorkspaceOpaqueId } from "@/utils/workspace-identity";
import type {
  SidebarProjectEntry,
  SidebarStateBucket,
  SidebarWorkspacePlacement,
} from "./sidebar-workspaces-view-model";
import type { Agent } from "@/stores/session-store";
import { deriveSidebarStateBucket } from "@/utils/sidebar-agent-state";

export interface SidebarConversationAgent {
  serverId: string;
  id: string;
  workspaceId?: string;
  parentAgentId: string | null;
  title: string | null;
  createdAtMs: number;
  archivedAt?: Date | null;
  projectKey?: string | null;
  projectName?: string | null;
  cwd?: string | null;
  statusBucket?: SidebarStateBucket;
  statusEnteredAt?: Date | null;
}

export function standaloneConversationKey(serverId: string, agentId: string): string {
  return `${serverId}:standalone:${agentId}`;
}

export function isWorkspaceBackedOneToOne(
  placement: Pick<
    SidebarWorkspacePlacement,
    "serverId" | "workspaceId" | "workspaceKey" | "standalone" | "agentId"
  >,
): boolean {
  if (placement.standalone) {
    return false;
  }
  const workspaceId = normalizeWorkspaceOpaqueId(placement.workspaceId);
  if (!workspaceId) {
    return false;
  }
  return placement.workspaceKey === `${placement.serverId}:${workspaceId}`;
}

export type SidebarArchiveTarget = { kind: "agent"; agentId: string } | { kind: "workspace" };

function conversationWorkspaceKey(
  serverId: string,
  workspaceId: string,
  agentId: string | null,
  split: boolean,
): string {
  if (!split || !agentId) {
    return `${serverId}:${workspaceId}`;
  }
  return `${serverId}:${workspaceId}:a:${agentId}`;
}

function agentsByWorkspace(
  agents: readonly SidebarConversationAgent[],
): Map<string, SidebarConversationAgent[]> {
  const grouped = new Map<string, SidebarConversationAgent[]>();
  const byId = new Map(agents.map((agent) => [agent.id, agent]));

  for (const agent of agents) {
    if (agent.archivedAt) continue;
    const workspaceId = normalizeWorkspaceOpaqueId(agent.workspaceId);
    if (!workspaceId) continue;
    const parent = agent.parentAgentId ? byId.get(agent.parentAgentId) : undefined;
    if (!isWorkspaceRootAgent(agent, parent)) continue;

    const existing = grouped.get(workspaceId);
    if (existing) {
      existing.push(agent);
    } else {
      grouped.set(workspaceId, [agent]);
    }
  }

  for (const siblings of grouped.values()) {
    siblings.sort(
      (left, right) => right.createdAtMs - left.createdAtMs || left.id.localeCompare(right.id),
    );
  }
  return grouped;
}

function placementForConversation(
  placement: SidebarWorkspacePlacement,
  agent: SidebarConversationAgent | null,
  split: boolean,
): SidebarWorkspacePlacement {
  const agentId = agent?.id ?? null;
  return {
    ...placement,
    workspaceKey: conversationWorkspaceKey(
      placement.serverId,
      placement.workspaceId,
      agentId,
      split,
    ),
    agentId,
    conversationTitle: agent?.title ?? null,
    ...(agent?.statusBucket
      ? {
          statusBucket: agent.statusBucket,
          statusEnteredAt: agent.statusEnteredAt ?? null,
        }
      : {}),
  };
}

function standalonePlacement(
  project: SidebarProjectEntry,
  agent: SidebarConversationAgent,
): SidebarWorkspacePlacement {
  return {
    workspaceKey: standaloneConversationKey(agent.serverId, agent.id),
    serverId: agent.serverId,
    workspaceId: "",
    projectViewKey: project.viewKey,
    projectName: project.projectName,
    projectRootPath: project.iconWorkingDir,
    workspaceDirectory: agent.cwd ?? undefined,
    projectKind: project.projectKind,
    workspaceKind: "directory",
    name: agent.title ?? agent.id,
    agentId: agent.id,
    conversationTitle: agent.title,
    standalone: true,
    ...(agent.statusBucket
      ? { statusBucket: agent.statusBucket, statusEnteredAt: agent.statusEnteredAt ?? null }
      : {}),
  };
}

function standaloneProjectKey(agent: SidebarConversationAgent): string {
  const projectKey = agent.projectKey?.trim();
  if (projectKey) {
    return projectKey;
  }
  const cwd = agent.cwd?.trim();
  if (cwd) {
    return deriveProjectKey(cwd);
  }
  return `${agent.serverId}:standalone`;
}

function createSyntheticStandaloneProject(agent: SidebarConversationAgent): SidebarProjectEntry {
  const projectKey = standaloneProjectKey(agent);
  const iconWorkingDir = agent.cwd?.trim() ?? "";
  return {
    viewKey: JSON.stringify(["standalone", agent.serverId, projectKey]),
    projectKey,
    projectName: agent.projectName?.trim() || deriveProjectName(projectKey),
    projectKind: "unknown",
    iconWorkingDir,
    hosts: iconWorkingDir
      ? [
          {
            serverId: agent.serverId,
            projectId: projectKey,
            iconWorkingDir,
            worktreeSupport: "unknown",
          },
        ]
      : [],
    workspaces: [],
    isSynthetic: true,
  };
}

function datesEqual(left: Date | null | undefined, right: Date | null | undefined): boolean {
  return (left?.getTime() ?? null) === (right?.getTime() ?? null);
}

function matchStandaloneProject(
  projects: SidebarProjectEntry[],
  agent: SidebarConversationAgent,
): SidebarProjectEntry | null {
  if (agent.projectKey) {
    const byKey = projects.find(
      (project) =>
        (project.projectKey === agent.projectKey || project.viewKey === agent.projectKey) &&
        project.hosts.some((host) => host.serverId === agent.serverId),
    );
    if (byKey) {
      return byKey;
    }
  }
  const cwd = agent.cwd?.trim();
  if (!cwd) {
    return null;
  }
  return (
    projects.find((project) => {
      if (!project.hosts.some((host) => host.serverId === agent.serverId)) {
        return false;
      }
      const root = project.iconWorkingDir.trim();
      return cwd === root || (root.length > 0 && cwd.startsWith(`${root}/`));
    }) ?? null
  );
}

/** Turns each project's workspaces into conversation rows: one row per root agent. */
export function expandProjectsIntoConversations(input: {
  projects: SidebarProjectEntry[];
  agents: readonly SidebarConversationAgent[];
}): SidebarProjectEntry[] {
  const grouped = agentsByWorkspace(input.agents);
  const standaloneByProject = new Map<string, SidebarConversationAgent[]>();
  const standaloneBySyntheticProject = new Map<
    string,
    { project: SidebarProjectEntry; agents: SidebarConversationAgent[] }
  >();
  const byId = new Map(input.agents.map((agent) => [agent.id, agent]));
  for (const agent of input.agents) {
    if (agent.archivedAt || normalizeWorkspaceOpaqueId(agent.workspaceId)) {
      continue;
    }
    const parent = agent.parentAgentId ? byId.get(agent.parentAgentId) : undefined;
    if (!isWorkspaceRootAgent(agent, parent)) {
      continue;
    }
    const project = matchStandaloneProject(input.projects, agent);
    if (project) {
      const existing = standaloneByProject.get(project.viewKey);
      if (existing) {
        existing.push(agent);
      } else {
        standaloneByProject.set(project.viewKey, [agent]);
      }
      continue;
    }

    const syntheticProject = createSyntheticStandaloneProject(agent);
    const synthetic = standaloneBySyntheticProject.get(syntheticProject.viewKey);
    if (synthetic) {
      synthetic.agents.push(agent);
    } else {
      standaloneBySyntheticProject.set(syntheticProject.viewKey, {
        project: syntheticProject,
        agents: [agent],
      });
    }
  }
  for (const siblings of standaloneByProject.values()) {
    siblings.sort(
      (left, right) => right.createdAtMs - left.createdAtMs || left.id.localeCompare(right.id),
    );
  }
  for (const { agents } of standaloneBySyntheticProject.values()) {
    agents.sort(
      (left, right) => right.createdAtMs - left.createdAtMs || left.id.localeCompare(right.id),
    );
  }

  let changed = standaloneBySyntheticProject.size > 0;
  const projects = input.projects.map((project) => {
    const workspaces: SidebarWorkspacePlacement[] = [];
    let projectChanged = false;

    for (const placement of project.workspaces) {
      const workspaceId =
        normalizeWorkspaceOpaqueId(placement.workspaceId) ?? placement.workspaceId;
      const conversations = grouped.get(workspaceId) ?? [];
      if (conversations.length === 0) {
        workspaces.push(placement);
        continue;
      }
      if (conversations.length === 1) {
        const next = placementForConversation(placement, conversations[0] ?? null, false);
        projectChanged ||=
          next.agentId !== placement.agentId ||
          next.conversationTitle !== placement.conversationTitle ||
          next.statusBucket !== placement.statusBucket ||
          !datesEqual(next.statusEnteredAt, placement.statusEnteredAt);
        workspaces.push(next);
        continue;
      }

      projectChanged = true;
      for (const agent of conversations) {
        workspaces.push(placementForConversation(placement, agent, true));
      }
    }

    const standaloneAgents = standaloneByProject.get(project.viewKey) ?? [];
    if (standaloneAgents.length > 0) {
      projectChanged = true;
      for (const agent of standaloneAgents) {
        workspaces.push(standalonePlacement(project, agent));
      }
    }

    if (!projectChanged) {
      return project;
    }
    changed = true;
    return { ...project, workspaces };
  });

  for (const { project, agents } of standaloneBySyntheticProject.values()) {
    projects.push({
      ...project,
      workspaces: agents.map((agent) => standalonePlacement(project, agent)),
    });
  }

  return changed ? projects : input.projects;
}

export function countWorkspaceRootConversations(input: {
  agents: Iterable<SidebarConversationAgent>;
  workspaceId: string;
}): number {
  const workspaceId = normalizeWorkspaceOpaqueId(input.workspaceId) ?? input.workspaceId;
  return agentsByWorkspace([...input.agents]).get(workspaceId)?.length ?? 0;
}

export function resolveSidebarArchiveTarget(input: {
  agentId: string | null | undefined;
  siblingConversationCount: number;
}): SidebarArchiveTarget {
  if (input.agentId && input.siblingConversationCount > 1) {
    return { kind: "agent", agentId: input.agentId };
  }
  return { kind: "workspace" };
}

export function resolveArchiveForSidebarRow(input: {
  agentId: string | null | undefined;
  workspaceId: string;
  standalone?: boolean;
  agents: Iterable<SidebarConversationAgent>;
}): SidebarArchiveTarget {
  if (input.standalone || !normalizeWorkspaceOpaqueId(input.workspaceId)) {
    return input.agentId ? { kind: "agent", agentId: input.agentId } : { kind: "workspace" };
  }
  return resolveSidebarArchiveTarget({
    agentId: input.agentId,
    siblingConversationCount: countWorkspaceRootConversations({
      agents: input.agents,
      workspaceId: input.workspaceId,
    }),
  });
}

export function resolveConversationPinnedAt(input: {
  placement: Pick<
    SidebarWorkspacePlacement,
    "workspaceKey" | "serverId" | "workspaceId" | "standalone" | "agentId"
  >;
  conversationPinnedAt?: string | null;
  workspacePinnedAt?: string | null;
}): string | null {
  if (input.conversationPinnedAt) {
    return input.conversationPinnedAt;
  }
  if (!isWorkspaceBackedOneToOne(input.placement)) {
    return null;
  }
  return input.workspacePinnedAt ?? null;
}

interface SessionAgentRef {
  id: string;
  workspaceId?: string;
  parentAgentId: string | null;
  title: string | null;
  createdAt: Date;
  status: Agent["status"];
  turn: Agent["turn"];
  pendingPermissions: Agent["pendingPermissions"];
  requiresAttention?: Agent["requiresAttention"];
  attentionReason?: Agent["attentionReason"];
  attentionTimestamp?: Agent["attentionTimestamp"];
  updatedAt: Agent["updatedAt"];
  archivedAt?: Date | null;
  cwd?: string;
  projectPlacement?: Pick<
    NonNullable<Agent["projectPlacement"]>,
    "projectKey" | "projectName"
  > | null;
}

export function selectConversationAgentRefs(
  sessions: Record<string, { agents?: ReadonlyMap<string, SessionAgentRef> } | undefined>,
  serverIds: readonly string[],
): SidebarConversationAgent[] {
  const refs: SidebarConversationAgent[] = [];
  for (const serverId of serverIds) {
    const agents = sessions[serverId]?.agents;
    if (!agents) continue;
    for (const agent of agents.values()) {
      if (agent.archivedAt) continue;
      refs.push({
        serverId,
        id: agent.id,
        workspaceId: agent.workspaceId,
        parentAgentId: agent.parentAgentId,
        title: agent.title,
        createdAtMs: agent.createdAt.getTime(),
        projectKey:
          agent.projectPlacement?.projectKey ??
          (!agent.workspaceId && agent.cwd ? deriveProjectKey(agent.cwd) : null),
        projectName:
          agent.projectPlacement?.projectName ??
          (!agent.workspaceId && agent.cwd ? deriveProjectName(deriveProjectKey(agent.cwd)) : null),
        cwd: agent.cwd,
        statusBucket: deriveSidebarStateBucket({
          status: agent.turn.phase === "open" ? "running" : agent.status,
          pendingPermissionCount: agent.pendingPermissions.length,
          requiresAttention: agent.requiresAttention,
          attentionReason: agent.attentionReason,
        }),
        statusEnteredAt: agent.attentionTimestamp ?? agent.updatedAt,
      });
    }
  }
  return refs;
}
