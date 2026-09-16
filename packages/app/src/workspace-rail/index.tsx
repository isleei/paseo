import { useCallback, useMemo, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ChevronLeft, ChevronRight } from "lucide-react-native";
import {
  useWorkspaceAttachmentScopeKey,
  useWorkspaceAttachments,
} from "@/attachments/workspace-attachments-store";
import { FloatingSurface } from "@/components/ui/floating";
import { useIsCompactFormFactor, WORKSPACE_SECONDARY_HEADER_HEIGHT } from "@/constants/layout";
import { isWeb } from "@/constants/platform";
import { useCheckoutStatusQuery } from "@/git/use-status-query";
import type { OpenInSidePanePreferences } from "@/hooks/use-settings";
import type { ExplorerCheckoutContext } from "@/stores/explorer-checkout-context";
import { useSessionStore } from "@/stores/session-store";
import { type Theme } from "@/styles/theme";
import type { StreamItem, TodoEntry } from "@/types/stream";
import { openExternalUrl } from "@/utils/open-external-url";
import { openPreferredWorkspaceTarget } from "@/workspace-tabs/open-beside";
import { openWorkspaceChanges } from "@/workspace-tabs/open-supporting-view";
import { ArtifactsSection } from "@/workspace-rail/sections/artifacts-section";
import { EnvironmentSection } from "@/workspace-rail/sections/environment-section";
import { SourcesSection } from "@/workspace-rail/sections/sources-section";
import { SubagentsSection } from "@/workspace-rail/sections/subagents-section";
import { TasksSection } from "@/workspace-rail/sections/tasks-section";
import {
  deriveRailGitState,
  deriveRailSessionDerived,
  isSectionOpen,
  type RailWebSource,
} from "@/workspace-rail/rail-state";
import { useWorkspaceRailStore } from "@/workspace-rail/store";

const ThemedChevronLeft = withUnistyles(ChevronLeft);
const ThemedChevronRight = withUnistyles(ChevronRight);

const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/** Module-level so the tasks section's `useMemo` sees a stable value while an agent has none. */
const EMPTY_TASKS: TodoEntry[] = [];
const EMPTY_STREAM_ITEMS: StreamItem[] = [];

/**
 * The desktop workspace's ambient state — checkout, task list, changed files, subagents — as a
 * floating rail on the right edge of the chat area.
 *
 * It exists because the composer's tracks bar is transient: it sits at the bottom of the transcript
 * and scrolls out of the way, so a long task list is only readable by scrolling back to the
 * composer. The rail stays put while the transcript moves.
 *
 * Desktop only. On a phone the same data is a thumb's reach from the composer, and a floating
 * overlay would cover the transcript it exists to complement.
 */
export function WorkspaceInfoRail({
  serverId,
  workspaceId,
  cwd,
  agentId,
  checkout,
  preferences,
  workspaceKey,
  hidden = false,
}: {
  serverId: string | null;
  workspaceId: string | null;
  cwd: string | null;
  agentId: string | null;
  checkout: ExplorerCheckoutContext | null;
  preferences: OpenInSidePanePreferences;
  workspaceKey: string | null;
  hidden?: boolean;
}): ReactElement | null {
  const isCompact = useIsCompactFormFactor();
  if (hidden || isCompact || !serverId || !workspaceId || !cwd) {
    return null;
  }
  return (
    <WorkspaceInfoRailInner
      serverId={serverId}
      workspaceId={workspaceId}
      cwd={cwd}
      agentId={agentId}
      checkout={checkout}
      preferences={preferences}
      workspaceKey={workspaceKey}
    />
  );
}

function WorkspaceInfoRailInner({
  serverId,
  workspaceId,
  cwd,
  agentId,
  checkout,
  preferences,
  workspaceKey,
}: {
  serverId: string;
  workspaceId: string;
  cwd: string;
  agentId: string | null;
  checkout: ExplorerCheckoutContext | null;
  preferences: OpenInSidePanePreferences;
  workspaceKey: string | null;
}): ReactElement {
  const { t } = useTranslation();
  const collapsed = useWorkspaceRailStore((state) => state.collapsed);
  const closedSections = useWorkspaceRailStore((state) => state.closedSections);
  const toggleCollapsed = useWorkspaceRailStore((state) => state.toggleCollapsed);
  const toggleSection = useWorkspaceRailStore((state) => state.toggleSection);

  const { status } = useCheckoutStatusQuery({ serverId, cwd });
  const git = useMemo(() => deriveRailGitState(status), [status]);
  const tasks = useSessionStore((state): TodoEntry[] | undefined =>
    agentId ? state.sessions[serverId]?.agentTasks.get(agentId) : undefined,
  );

  // The session's own output — files it wrote, sources it read, skills it invoked — read out of the
  // loaded timeline in one pass. Absent agent, absent tail: an empty list, not a special case.
  const streamItems = useSessionStore((state): StreamItem[] | undefined =>
    agentId ? state.sessions[serverId]?.agentStreamTail.get(agentId) : undefined,
  );
  const sessionDerived = useMemo(
    () => deriveRailSessionDerived(streamItems ?? EMPTY_STREAM_ITEMS),
    [streamItems],
  );

  const attachmentScopeKey = useWorkspaceAttachmentScopeKey({ serverId, workspaceId, cwd });
  const uploadedAttachments = useWorkspaceAttachments(attachmentScopeKey);
  const uploadedCount = uploadedAttachments.length;

  // One stable toggle per section: `Section` is memoized on its props, and a fresh closure each
  // render would fold and unfold it for nothing.
  const handleToggleTasks = useCallback(() => toggleSection("tasks"), [toggleSection]);
  const handleToggleArtifacts = useCallback(() => toggleSection("artifacts"), [toggleSection]);
  const handleToggleSources = useCallback(() => toggleSection("sources"), [toggleSection]);
  const handleToggleEnvironment = useCallback(() => toggleSection("environment"), [toggleSection]);
  const handleToggleSubagents = useCallback(() => toggleSection("subagents"), [toggleSection]);

  const handleOpenChanges = useCallback(() => {
    openWorkspaceChanges({
      isCompact: false,
      workspaceKey,
      checkout,
      preferences,
    });
  }, [checkout, preferences, workspaceKey]);

  // An artifact or a read file opens as a file tab: the rail names it, the pane shows it.
  const handleOpenFile = useCallback(
    (path: string) => {
      openPreferredWorkspaceTarget({
        isCompact: false,
        workspaceKey,
        target: { kind: "file", path },
        source: "chatFiles",
        preferences,
      });
    },
    [preferences, workspaceKey],
  );

  // A web source has no in-app view, so its row is a link out.
  const handleOpenWebSource = useCallback((source: RailWebSource) => {
    if (!source.url) return;
    void openExternalUrl(source.url);
  }, []);

  if (collapsed) {
    return (
      <View style={styles.slot} pointerEvents="box-none">
        <Pressable
          onPress={toggleCollapsed}
          style={styles.collapsedTab}
          accessibilityRole="button"
          accessibilityLabel={t("workspace.git.rail.expand", "展开面板")}
          testID="workspace-rail-expand"
        >
          <ThemedChevronLeft size={14} uniProps={mutedColorMapping} />
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.slot} pointerEvents="box-none">
      <FloatingSurface style={styles.panel} testID="workspace-rail">
        <View style={styles.header}>
          <Pressable
            onPress={toggleCollapsed}
            style={styles.headerButton}
            accessibilityRole="button"
            accessibilityLabel={t("workspace.git.rail.collapse", "收起面板")}
            testID="workspace-rail-collapse"
          >
            <ThemedChevronRight size={14} uniProps={mutedColorMapping} />
          </Pressable>
        </View>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {git ? (
            <EnvironmentSection
              key="environment"
              serverId={serverId}
              cwd={cwd}
              workspaceId={workspaceId}
              git={git}
              divided={false}
              open={isSectionOpen(closedSections, "environment")}
              onToggle={handleToggleEnvironment}
              onOpenChanges={handleOpenChanges}
            />
          ) : null}
          <TasksSection
            key="tasks"
            tasks={tasks ?? EMPTY_TASKS}
            divided={Boolean(git)}
            open={isSectionOpen(closedSections, "tasks")}
            onToggle={handleToggleTasks}
          />
          <ArtifactsSection
            key="artifacts"
            artifacts={sessionDerived.artifacts}
            divided
            isExpanded={isSectionOpen(closedSections, "artifacts")}
            onToggleExpanded={handleToggleArtifacts}
            onOpenArtifact={handleOpenFile}
          />
          <SourcesSection
            key="sources"
            webSources={sessionDerived.webSources}
            projectFiles={sessionDerived.projectFiles}
            uploadedCount={uploadedCount}
            divided
            isExpanded={isSectionOpen(closedSections, "sources")}
            onToggleExpanded={handleToggleSources}
            onOpenWebSource={handleOpenWebSource}
            onOpenProjectFile={handleOpenFile}
          />
          {agentId ? (
            <SubagentsSection
              serverId={serverId}
              parentAgentId={agentId}
              divided
              open={isSectionOpen(closedSections, "subagents")}
              onToggle={handleToggleSubagents}
            />
          ) : null}
        </ScrollView>
      </FloatingSurface>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  slot: {
    position: "absolute",
    top: WORKSPACE_SECONDARY_HEADER_HEIGHT + theme.spacing[3],
    right: theme.spacing[3],
    bottom: theme.spacing[6],
    width: 288,
    zIndex: 20,
  },
  panel: {
    maxHeight: "100%",
    backgroundColor: theme.colors.surface1,
    borderWidth: theme.borderWidth[1],
    borderColor: isWeb ? "rgba(0, 0, 0, 0.08)" : theme.colors.border,
    borderRadius: theme.borderRadius.xl,
    ...(isWeb
      ? {
          boxShadow: "0 4px 16px rgba(0, 0, 0, 0.08)",
        }
      : theme.shadow.md),
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingHorizontal: theme.spacing[2],
    paddingTop: theme.spacing[1],
  },
  headerButton: {
    padding: theme.spacing[1],
    borderRadius: theme.borderRadius.sm,
  },
  scroll: {
    flexGrow: 0,
    flexShrink: 1,
    minHeight: 0,
  },
  scrollContent: {
    paddingBottom: theme.spacing[3],
  },
  collapsedTab: {
    position: "absolute",
    right: 0,
    top: 0,
    backgroundColor: theme.colors.surface1,
    borderWidth: theme.borderWidth[1],
    borderColor: isWeb ? "rgba(0, 0, 0, 0.08)" : theme.colors.border,
    borderRightWidth: 0,
    borderTopLeftRadius: theme.borderRadius.md,
    borderBottomLeftRadius: theme.borderRadius.md,
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[1],
    ...(isWeb
      ? {
          boxShadow: "0 2px 8px rgba(0, 0, 0, 0.06)",
        }
      : theme.shadow.md),
  },
}));
