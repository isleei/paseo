import { useIsCompactFormFactor } from "@/constants/layout";
import { useWorkspaceRailStore } from "@/workspace-rail/store";
import { useIsExplorerSidebarOpen } from "@/workspace-tabs/explorer-sidebar";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";

/**
 * Returns true if the desktop workspace-info rail is currently active and visible
 * (i.e. not in compact layout, not collapsed, not obscured by explorer sidebar, and in a workspace).
 */
export function useIsWorkspaceRailActive(input: {
  serverId?: string | null;
  workspaceId?: string | null;
}): boolean {
  const isCompact = useIsCompactFormFactor();
  const isRailCollapsed = useWorkspaceRailStore((state) => state.collapsed);
  const persistenceKey =
    input.serverId && input.workspaceId
      ? buildWorkspaceTabPersistenceKey({
          serverId: input.serverId,
          workspaceId: input.workspaceId,
        })
      : null;
  const isExplorerSidebarShowing = useIsExplorerSidebarOpen({
    isCompact,
    workspaceKey: persistenceKey,
  });

  if (isCompact || isRailCollapsed || isExplorerSidebarShowing || !persistenceKey) {
    return false;
  }
  return true;
}
