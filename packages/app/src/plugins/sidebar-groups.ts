import type {
  EvaluatedPluginWorkspacePanelContribution,
  InstalledPlugin,
  PluginSidebarContribution,
} from "./types";

export interface PluginSidebarTarget {
  plugin: InstalledPlugin;
  item: PluginSidebarContribution;
}

export interface PluginSidebarGroup {
  key: string;
  pluginId: string;
  contributionId: string;
  title: string;
  icon: string;
  targets: PluginSidebarTarget[];
}

export function groupPluginSidebarContributions(plugins: InstalledPlugin[]): PluginSidebarGroup[] {
  const groups = new Map<string, PluginSidebarGroup>();
  for (const plugin of plugins) {
    for (const item of plugin.sidebarItems) {
      const key = `${plugin.id}/sidebar/${item.id}`;
      const existing = groups.get(key);
      if (existing) {
        existing.targets.push({ plugin, item });
      } else {
        groups.set(key, {
          key,
          pluginId: plugin.id,
          contributionId: item.id,
          title: item.title,
          icon: item.icon,
          targets: [{ plugin, item }],
        });
      }
    }
  }
  return [...groups.values()];
}

export interface PluginSidebarPanelTarget {
  plugin: InstalledPlugin;
  panel: EvaluatedPluginWorkspacePanelContribution;
}

export interface PluginSidebarPanelGroup {
  key: string;
  pluginId: string;
  contributionId: string;
  title: string;
  icon: string;
  targets: PluginSidebarPanelTarget[];
}

/**
 * Workspace panels that opted into `sidebar: true`. Agent panels can never opt in
 * (evaluation rejects them), so only workspace-context panels land here; the context
 * check below is defense for hand-built registries.
 */
export function groupPluginSidebarPanelContributions(
  plugins: InstalledPlugin[],
): PluginSidebarPanelGroup[] {
  const groups = new Map<string, PluginSidebarPanelGroup>();
  for (const plugin of plugins) {
    for (const panel of plugin.workspacePanels) {
      if (panel.sidebar !== true || panel.context !== "workspace") continue;
      const key = `${plugin.id}/panel/${panel.id}`;
      const existing = groups.get(key);
      if (existing) {
        existing.targets.push({ plugin, panel });
      } else {
        groups.set(key, {
          key,
          pluginId: plugin.id,
          contributionId: panel.id,
          title: panel.title,
          icon: panel.icon,
          targets: [{ plugin, panel }],
        });
      }
    }
  }
  return [...groups.values()];
}
