import { useMemo, useRef } from "react";
import { shallow } from "zustand/shallow";
import { useStoreWithEqualityFn } from "zustand/traditional";
import type {
  SidebarProjectEntry,
  SidebarWorkspaceEntry,
  SidebarWorkspacePlacement,
} from "@/hooks/use-sidebar-workspaces-list";
import { applyStoredOrdering } from "@/hooks/sidebar-workspaces-view-model";
import { resolveConversationPinnedAt } from "@/hooks/sidebar-conversations";
import { useSessionStore } from "@/stores/session-store";
import { useSidebarOrderStore } from "@/stores/sidebar-order-store";

export interface PinnedSidebarKeys {
  pinnedWorkspaceKeys: string[];
  // workspaceKey -> pinnedAt ISO string, used to order by recency.
  pinnedAtByKey: Record<string, string>;
}

export interface PinnedSidebarGroups {
  // Status grouping still hoists these into a dedicated Pinned section. Project grouping
  // leaves this empty and keeps the chats in `unpinnedProjects`, pinned-first.
  pinnedChats: SidebarWorkspacePlacement[];
  // Project list. When chats are not hoisted, pinned workspaces stay here at the top of
  // their project. When they are hoisted, they are removed so the Pinned section owns them.
  unpinnedProjects: SidebarProjectEntry[];
}

function projectWithoutPinnedWorkspaces(
  project: SidebarProjectEntry,
  pinnedWorkspaceKeys: ReadonlySet<string>,
): SidebarProjectEntry {
  const workspaces = project.workspaces.filter(
    (workspace) => !pinnedWorkspaceKeys.has(workspace.workspaceKey),
  );
  // Keep the project even when every chat moved to Pinned. The project row owns
  // its settings and new-workspace actions; chats are not its ownership boundary.
  return workspaces.length === project.workspaces.length ? project : { ...project, workspaces };
}

function buildPinnedSidebarKeys(
  projects: SidebarProjectEntry[],
  workspaceMaps: ReadonlyMap<string, ReadonlyMap<string, { pinnedAt?: string | null }>>,
  conversationPinnedAtByKey: Readonly<Record<string, string>>,
): PinnedSidebarKeys {
  const pinnedWorkspaceKeys: string[] = [];
  const pinnedAtByKey: Record<string, string> = {};

  for (const project of projects) {
    for (const placement of project.workspaces) {
      const workspace = workspaceMaps.get(placement.serverId)?.get(placement.workspaceId);
      const pinnedAt = resolveConversationPinnedAt({
        placement,
        conversationPinnedAt: conversationPinnedAtByKey[placement.workspaceKey],
        workspacePinnedAt: workspace?.pinnedAt,
      });
      if (pinnedAt) {
        pinnedWorkspaceKeys.push(placement.workspaceKey);
        pinnedAtByKey[placement.workspaceKey] = pinnedAt;
      }
    }
  }
  return { pinnedWorkspaceKeys, pinnedAtByKey };
}

function arePinnedSidebarKeysEqual(left: PinnedSidebarKeys, right: PinnedSidebarKeys): boolean {
  if (left.pinnedWorkspaceKeys.length !== right.pinnedWorkspaceKeys.length) {
    return false;
  }
  for (let index = 0; index < left.pinnedWorkspaceKeys.length; index += 1) {
    const workspaceKey = left.pinnedWorkspaceKeys[index];
    if (
      workspaceKey !== right.pinnedWorkspaceKeys[index] ||
      (workspaceKey && left.pinnedAtByKey[workspaceKey] !== right.pinnedAtByKey[workspaceKey])
    ) {
      return false;
    }
  }
  return true;
}

export function usePinnedSidebarKeys(projects: SidebarProjectEntry[]): PinnedSidebarKeys {
  const previousKeysRef = useRef<PinnedSidebarKeys>({
    pinnedWorkspaceKeys: [],
    pinnedAtByKey: {},
  });
  const serverIds = useMemo(
    () =>
      Array.from(
        new Set(
          projects.flatMap((project) => project.workspaces.map((workspace) => workspace.serverId)),
        ),
      ),
    [projects],
  );
  const workspaceMaps = useStoreWithEqualityFn(
    useSessionStore,
    (state) => serverIds.map((serverId) => state.sessions[serverId]?.workspaces ?? null),
    shallow,
  );
  const conversationPinnedAtByKey = useSidebarOrderStore(
    (state) => state.pinnedAtByConversationKey,
  );
  return useMemo(() => {
    const workspaceMapByServerId = new Map<
      string,
      ReadonlyMap<string, { pinnedAt?: string | null }>
    >();
    for (let index = 0; index < serverIds.length; index += 1) {
      const serverId = serverIds[index];
      const workspaceMap = workspaceMaps[index];
      if (serverId && workspaceMap) {
        workspaceMapByServerId.set(serverId, workspaceMap);
      }
    }
    const nextKeys = buildPinnedSidebarKeys(
      projects,
      workspaceMapByServerId,
      conversationPinnedAtByKey,
    );
    if (arePinnedSidebarKeysEqual(previousKeysRef.current, nextKeys)) {
      return previousKeysRef.current;
    }
    previousKeysRef.current = nextKeys;
    return nextKeys;
  }, [conversationPinnedAtByKey, projects, serverIds, workspaceMaps]);
}

function comparePinnedRecency(
  leftKey: string,
  rightKey: string,
  pinnedAtByKey: Record<string, string>,
): number {
  return (pinnedAtByKey[rightKey] ?? "").localeCompare(pinnedAtByKey[leftKey] ?? "");
}

function orderWorkspacesPinnedFirst(input: {
  workspaces: SidebarWorkspacePlacement[];
  pinnedWorkspaceKeys: ReadonlySet<string>;
  pinnedAtByKey: Record<string, string>;
  pinnedWorkspaceOrder: string[];
}): SidebarWorkspacePlacement[] {
  const pinned: SidebarWorkspacePlacement[] = [];
  const unpinned: SidebarWorkspacePlacement[] = [];
  for (const workspace of input.workspaces) {
    if (input.pinnedWorkspaceKeys.has(workspace.workspaceKey)) {
      pinned.push(workspace);
    } else {
      unpinned.push(workspace);
    }
  }
  if (pinned.length === 0) {
    return input.workspaces;
  }

  pinned.sort((left, right) =>
    comparePinnedRecency(left.workspaceKey, right.workspaceKey, input.pinnedAtByKey),
  );

  return [
    ...applyStoredOrdering({
      items: pinned,
      storedOrder: input.pinnedWorkspaceOrder,
      getKey: (workspace) => workspace.workspaceKey,
    }),
    ...unpinned,
  ];
}

// Project grouping keeps pinned chats at the top of their project. Status grouping still
// hoists them into a dedicated Pinned section because that mode has no project container.
export function overlayConversationPins(
  entries: ReadonlyMap<string, SidebarWorkspaceEntry>,
  pinnedAtByKey: Record<string, string>,
): ReadonlyMap<string, SidebarWorkspaceEntry> {
  if (entries.size === 0) {
    return entries;
  }
  let changed = false;
  const next = new Map<string, SidebarWorkspaceEntry>();
  for (const [key, entry] of entries) {
    const pinnedAt = pinnedAtByKey[key] ?? null;
    if (entry.pinnedAt === pinnedAt) {
      next.set(key, entry);
      continue;
    }
    changed = true;
    next.set(key, { ...entry, pinnedAt });
  }
  return changed ? next : entries;
}

export function splitPinnedSidebarGroups(input: {
  projects: SidebarProjectEntry[];
  keys: PinnedSidebarKeys;
  pinnedWorkspaceOrder: string[];
  hoistPinned: boolean;
}): PinnedSidebarGroups {
  const { projects, keys, pinnedWorkspaceOrder, hoistPinned } = input;
  if (keys.pinnedWorkspaceKeys.length === 0) {
    return { pinnedChats: [], unpinnedProjects: projects };
  }
  const pinnedWorkspaceKeySet = new Set(keys.pinnedWorkspaceKeys);

  if (!hoistPinned) {
    return {
      pinnedChats: [],
      unpinnedProjects: projects.map((project) => {
        const workspaces = orderWorkspacesPinnedFirst({
          workspaces: project.workspaces,
          pinnedWorkspaceKeys: pinnedWorkspaceKeySet,
          pinnedAtByKey: keys.pinnedAtByKey,
          pinnedWorkspaceOrder,
        });
        return workspaces === project.workspaces ? project : { ...project, workspaces };
      }),
    };
  }

  const pinnedChats: SidebarWorkspacePlacement[] = [];
  const unpinnedProjects: SidebarProjectEntry[] = [];

  for (const project of projects) {
    for (const workspace of project.workspaces) {
      if (pinnedWorkspaceKeySet.has(workspace.workspaceKey)) {
        pinnedChats.push(workspace);
      }
    }
    unpinnedProjects.push(projectWithoutPinnedWorkspaces(project, pinnedWorkspaceKeySet));
  }

  pinnedChats.sort((a, b) =>
    comparePinnedRecency(a.workspaceKey, b.workspaceKey, keys.pinnedAtByKey),
  );

  return {
    pinnedChats: applyStoredOrdering({
      items: pinnedChats,
      storedOrder: pinnedWorkspaceOrder,
      getKey: (workspace) => workspace.workspaceKey,
    }),
    unpinnedProjects,
  };
}
