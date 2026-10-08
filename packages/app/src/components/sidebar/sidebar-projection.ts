import type { TFunction } from "i18next";
import type { WorkspaceTitleSource } from "@/hooks/use-settings";
import { buildStatusGroups } from "@/hooks/sidebar-status-view-model";
import {
  splitPinnedSidebarGroups,
  type PinnedSidebarGroups,
  type PinnedSidebarKeys,
} from "@/hooks/use-sidebar-pins";
import type {
  SidebarProjectEntry,
  SidebarWorkspaceEntry,
} from "@/hooks/use-sidebar-workspaces-list";
import {
  resolveSidebarProjectFolderId,
  type SidebarFolder,
  type SidebarFolderAssignment,
} from "@/stores/sidebar-folders-store";
import type { SidebarGroupMode } from "@/stores/sidebar-view-store";
import { arrangeSidebarWorkspaces } from "./sidebar-arrangement";
import type { SidebarWorkspaceSortMode } from "@/stores/sidebar-view-store";
import {
  resolveSidebarProjectIconTargets,
  type SidebarProjectIconTarget,
} from "@/utils/sidebar-project-row-model";
import {
  buildSidebarShortcutSections,
  type SidebarShortcutModel,
  type SidebarShortcutSection,
} from "@/utils/sidebar-shortcuts";
import { statusWorkspaceGroups, type SidebarWorkspaceGroup } from "./sidebar-labels";

export interface SidebarFolderGroup {
  folder: SidebarFolder;
  collapsed: boolean;
  projects: SidebarProjectEntry[];
}

export interface SidebarProjectFolderGroups {
  folderGroups: SidebarFolderGroup[];
  /** Projects in no folder, rendered after every folder. */
  rootProjects: SidebarProjectEntry[];
}

export interface SidebarProjection {
  pinnedGroups: PinnedSidebarGroups;
  /** Project mode only: `pinnedGroups.unpinnedProjects` split by folder, in render order. */
  projectFolderGroups: SidebarProjectFolderGroups;
  workspaceGroups: SidebarWorkspaceGroup[];
  /**
   * The project icons this projection needs fetched, keyed by `projectViewKey` — one per project,
   * whatever the mode groups by. It sits here rather than beside `useProjectIcons` in the list
   * because it is the same `projects` the rows above are projected from: a mode that renders a
   * row can only ever ask for an icon this list already covers. It used to be derived in the
   * list, under a `groupMode === "status"` gate written when status was the only mode that put
   * icons on rows.
   */
  projectIconTargets: SidebarProjectIconTarget[];
  shortcutModel: SidebarShortcutModel;
}

export interface SidebarProjectionInput {
  projects: SidebarProjectEntry[];
  pinnedKeys: PinnedSidebarKeys;
  pinnedWorkspaceOrder: string[];
  workspaceEntriesByKey: ReadonlyMap<string, SidebarWorkspaceEntry>;
  projectNamesByViewKey: Map<string, string>;
  groupMode: SidebarGroupMode;
  workspaceSortMode: SidebarWorkspaceSortMode;
  workspaceTitleSource: WorkspaceTitleSource;
  statusWorkspaceOrder: string[];
  pinnedCollapsed: boolean;
  collapsedProjectKeys: ReadonlySet<string>;
  collapsedWorkspaceGroupKeys: ReadonlySet<string>;
  t: TFunction;
  folders: readonly SidebarFolder[];
  projectAssignments: readonly SidebarFolderAssignment[];
  collapsedFolderIds: readonly string[];
}

/**
 * Every folder renders, even one with nothing visible under it: an empty folder is still the
 * header you delete it from. A project pointing at a folder that no longer exists is a root project.
 */
export function groupSidebarProjectsByFolder(input: {
  projects: SidebarProjectEntry[];
  folders: readonly SidebarFolder[];
  projectAssignments: readonly SidebarFolderAssignment[];
  collapsedFolderIds: readonly string[];
}): SidebarProjectFolderGroups {
  const collapsed = new Set(input.collapsedFolderIds);
  const projectsByFolderId = new Map<string, SidebarProjectEntry[]>(
    input.folders.map((folder) => [folder.id, []]),
  );
  const rootProjects: SidebarProjectEntry[] = [];
  for (const project of input.projects) {
    const folderId = resolveSidebarProjectFolderId(input, project);
    const bucket = folderId ? projectsByFolderId.get(folderId) : undefined;
    (bucket ?? rootProjects).push(project);
  }
  return {
    folderGroups: input.folders.map((folder) => ({
      folder,
      collapsed: collapsed.has(folder.id),
      projects: projectsByFolderId.get(folder.id) ?? [],
    })),
    rootProjects,
  };
}

/** Project visible rows and keyboard shortcuts from the same sorting and pinning decisions. */
export function buildSidebarProjection(input: SidebarProjectionInput): SidebarProjection {
  const hoistPinned = input.groupMode !== "project";
  const pinnedGroups = splitPinnedSidebarGroups({
    projects: input.projects,
    keys: input.pinnedKeys,
    pinnedWorkspaceOrder: input.pinnedWorkspaceOrder,
    hoistPinned,
  });
  const pinnedWorkspaceKeys = new Set(input.pinnedKeys.pinnedWorkspaceKeys);
  if (input.groupMode === "project") {
    pinnedGroups.unpinnedProjects = pinnedGroups.unpinnedProjects.map((project) => {
      const pinned = project.workspaces.filter((workspace) =>
        pinnedWorkspaceKeys.has(workspace.workspaceKey),
      );
      const unpinned = project.workspaces.filter(
        (workspace) => !pinnedWorkspaceKeys.has(workspace.workspaceKey),
      );
      const sorted = arrangeSidebarWorkspaces({
        workspaces: unpinned,
        mode: input.workspaceSortMode,
        entries: input.workspaceEntriesByKey,
        workspaceTitleSource: input.workspaceTitleSource,
      });
      return { ...project, workspaces: [...pinned, ...sorted] };
    });
  }
  const unpinnedWorkspaces = hoistPinned
    ? Array.from(input.workspaceEntriesByKey.values()).filter(
        (workspace) => !pinnedWorkspaceKeys.has(workspace.workspaceKey),
      )
    : Array.from(input.workspaceEntriesByKey.values());
  // One switch decides both what the list groups by and what the keyboard shortcuts walk, so the
  // two cannot disagree and a new grouping mode is a compile error here rather than a silent
  // fall-through to the project rows.
  const workspaceGroups = buildWorkspaceGroups(input, unpinnedWorkspaces);
  const projectFolderGroups = groupSidebarProjectsByFolder({
    projects: pinnedGroups.unpinnedProjects,
    folders: input.folders,
    projectAssignments: input.projectAssignments,
    collapsedFolderIds: input.collapsedFolderIds,
  });

  const sections: SidebarShortcutSection[] = [];
  if (!input.pinnedCollapsed && pinnedGroups.pinnedChats.length > 0) {
    sections.push({ workspaces: pinnedGroups.pinnedChats });
  }
  if (input.groupMode === "project") {
    // Walk projects in the order they render: each folder's projects, then the root ones.
    for (const group of projectFolderGroups.folderGroups) {
      sections.push(
        ...group.projects.map((project) => ({
          workspaces: project.workspaces,
          collapsed: group.collapsed || input.collapsedProjectKeys.has(project.viewKey),
        })),
      );
    }
    sections.push(
      ...projectFolderGroups.rootProjects.map((project) => ({
        workspaces: project.workspaces,
        collapsed: input.collapsedProjectKeys.has(project.viewKey),
      })),
    );
  } else {
    sections.push(
      ...workspaceGroups.map((group) => ({
        workspaces: group.rows,
        collapsed: input.collapsedWorkspaceGroupKeys.has(group.key),
      })),
    );
  }

  return {
    pinnedGroups,
    projectFolderGroups,
    workspaceGroups,
    projectIconTargets: resolveSidebarProjectIconTargets(input.projects),
    shortcutModel: buildSidebarShortcutSections({ sections }),
  };
}

/** Project mode keeps its project headers and groups nothing; status mode groups the rows. */
function buildWorkspaceGroups(
  input: SidebarProjectionInput,
  unpinnedWorkspaces: SidebarWorkspaceEntry[],
): SidebarWorkspaceGroup[] {
  switch (input.groupMode) {
    case "project":
      return [];
    case "status": {
      const groups = statusWorkspaceGroups(
        buildStatusGroups(unpinnedWorkspaces, input.projectNamesByViewKey, input.t),
      );
      const mode = input.workspaceSortMode;
      if (mode === "status") return groups;
      const customKeys = input.statusWorkspaceOrder;
      const fallbackKeys = input.projects.flatMap((project) =>
        project.workspaces.map((workspace) => workspace.workspaceKey),
      );
      const ranks = new Map(
        [...new Set([...customKeys, ...fallbackKeys])].map((key, index) => [key, index]),
      );
      return groups.map((group) => {
        const rows = [...group.rows].sort(
          (a, b) => ranks.get(a.workspaceKey)! - ranks.get(b.workspaceKey)!,
        );
        group.rows = arrangeSidebarWorkspaces({
          workspaces: rows,
          mode,
          entries: input.workspaceEntriesByKey,
          workspaceTitleSource: input.workspaceTitleSource,
        });
        return group;
      });
    }
  }
}
