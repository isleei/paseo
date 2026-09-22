import { useCallback } from "react";
import { SidebarHeaderRow } from "@/components/sidebar/sidebar-header-row";
import { useToast } from "@/contexts/toast-context";
import { useActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { createPluginNavigation } from "./navigation";
import { resolvePluginIcon } from "./icons";
import { resolvePluginPanelOpenLocation } from "./workspace-panels/locations";
import type { PluginSidebarPanelGroup } from "./sidebar-groups";

/**
 * Left-sidebar entry for a workspace panel that opted into `sidebar: true`.
 * Panels need a workspace to render, so the entry only appears while a workspace
 * is active and opens the panel as a tab in that workspace. The active workspace
 * pins the host, so unlike sidebar items there is no cross-host target to pick:
 * the entry hides when the plugin is not installed on the active workspace's host.
 */
export function PluginSidebarPanelRow({
  group,
  onBeforeNavigate,
}: {
  group: PluginSidebarPanelGroup;
  onBeforeNavigate?: () => void;
}) {
  const selection = useActiveWorkspaceSelection();
  const toast = useToast();
  const target = selection
    ? (group.targets.find((candidate) => candidate.plugin.serverId === selection.serverId) ?? null)
    : null;

  const handlePress = useCallback(() => {
    if (!selection || !target) return;
    onBeforeNavigate?.();
    try {
      const location = resolvePluginPanelOpenLocation(target.panel);
      createPluginNavigation({
        serverId: selection.serverId,
        workspaceId: selection.workspaceId,
      }).openWorkspacePanel(target.plugin.id, target.panel.id, location);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to open panel");
    }
  }, [onBeforeNavigate, selection, target, toast]);

  if (!selection || !target) return null;
  return (
    <SidebarHeaderRow
      icon={resolvePluginIcon(group.icon)}
      label={group.title}
      onPress={handlePress}
      testID={`plugin-sidebar-panel-${group.pluginId}-${group.contributionId}`}
      variant="compact"
    />
  );
}
