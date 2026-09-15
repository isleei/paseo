import { useCallback, useMemo, useState, type ReactElement } from "react";
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
import { orderCheckoutDiffFiles } from "@/git/diff-order";
import { useCheckoutCommitsQuery, type ClassifiedCheckoutCommit } from "@/git/use-commits-query";
import { useCheckoutDiffQuery } from "@/git/use-diff-query";
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
import { ChangedFilesSection } from "@/workspace-rail/sections/changed-files-section";
import { CommitsSection } from "@/workspace-rail/sections/commits-section";
import { EnvironmentSection } from "@/workspace-rail/sections/environment-section";
import { SkillsSection } from "@/workspace-rail/sections/skills-section";
import { SourcesSection } from "@/workspace-rail/sections/sources-section";
import { SubagentsSection } from "@/workspace-rail/sections/subagents-section";
import { TasksSection } from "@/workspace-rail/sections/tasks-section";
import {
  deriveRailGitState,
  deriveRailSessionDerived,
  isSectionOpen,
  selectRailSections,
  type RailDecidedSectionId,
  type RailWebSource,
} from "@/workspace-rail/rail-state";
import { useWorkspaceRailStore } from "@/workspace-rail/store";

const ThemedChevronRight = withUnistyles(ChevronRight);
const ThemedChevronLeft = withUnistyles(ChevronLeft);

const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/** Module-level so the tasks section's `useMemo` sees a stable value while an agent has none. */
const EMPTY_TASKS: TodoEntry[] = [];
const EMPTY_COMMITS: ClassifiedCheckoutCommit[] = [];
const EMPTY_STREAM_ITEMS: StreamItem[] = [];
const NO_EXPANDED_FILES: ReadonlySet<string> = new Set();

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
}: {
  serverId: string | null;
  workspaceId: string | null;
  cwd: string | null;
  agentId: string | null;
  checkout: ExplorerCheckoutContext | null;
  preferences: OpenInSidePanePreferences;
  workspaceKey: string | null;
}): ReactElement | null {
  const isCompact = useIsCompactFormFactor();
  if (isCompact || !serverId || !workspaceId || !cwd) {
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
  const commitsQuery = useCheckoutCommitsQuery({ serverId, cwd });
  const commits = commitsQuery.status === "loaded" ? commitsQuery.data.commits : EMPTY_COMMITS;
  const tasks = useSessionStore((state): TodoEntry[] | undefined =>
    agentId ? state.sessions[serverId]?.agentTasks.get(agentId) : undefined,
  );

  // Kept on the rail rather than inside the section because the rail needs the count to decide
  // whether the section exists — a section that returns null after its own divider has drawn
  // leaves a stray line across the panel.
  //
  // `queryScope` is load-bearing. Without it this query shares a key with the one the Changes pane
  // opens, and the push router — which resolves one subscription per query — never opens one for
  // it, so the list stays empty forever. A scoped key gives the rail a subscription of its own.
  const { files: diffFiles } = useCheckoutDiffQuery({
    serverId,
    cwd,
    mode: "uncommitted",
    enabled: git !== null,
    queryScope: "workspace-rail-changes",
  });
  const changedFiles = useMemo(() => orderCheckoutDiffFiles(diffFiles), [diffFiles]);
  const [expandedFilePaths, setExpandedFilePaths] =
    useState<ReadonlySet<string>>(NO_EXPANDED_FILES);

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

  const visibleSections = useMemo(
    () =>
      selectRailSections({
        taskCount: tasks?.length ?? 0,
        changeCount: changedFiles.length,
        artifactCount: sessionDerived.artifacts.length,
        sourceCount: sessionDerived.webSources.length + sessionDerived.projectFiles.length,
        skillCount: sessionDerived.skills.length,
        isGit: git !== null,
        commitCount: commits.length,
      }),
    [
      changedFiles.length,
      commits.length,
      git,
      sessionDerived.artifacts.length,
      sessionDerived.projectFiles.length,
      sessionDerived.skills.length,
      sessionDerived.webSources.length,
      tasks,
    ],
  );

  // One stable toggle per section: `Section` is memoized on its props, and a fresh closure each
  // render would fold and unfold it for nothing.
  const handleToggleTasks = useCallback(() => toggleSection("tasks"), [toggleSection]);
  const handleToggleChanges = useCallback(() => toggleSection("changes"), [toggleSection]);
  const handleToggleArtifacts = useCallback(() => toggleSection("artifacts"), [toggleSection]);
  const handleToggleSources = useCallback(() => toggleSection("sources"), [toggleSection]);
  const handleToggleSkills = useCallback(() => toggleSection("skills"), [toggleSection]);
  const handleToggleEnvironment = useCallback(() => toggleSection("environment"), [toggleSection]);
  const handleToggleCommits = useCallback(() => toggleSection("commits"), [toggleSection]);
  const handleToggleSubagents = useCallback(() => toggleSection("subagents"), [toggleSection]);

  const handleToggleChangedFile = useCallback((path: string) => {
    setExpandedFilePaths((previous) => {
      const next = new Set(previous);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  // A file row opens the workspace Changes view with that file focused, so the
  // row stays a pointer into existing navigation rather than a second diff surface.
  const handleOpenChangedFile = useCallback(
    (path: string) => {
      openWorkspaceChanges({
        isCompact: false,
        workspaceKey,
        checkout,
        preferences,
        focusPath: path,
      });
    },
    [checkout, preferences, workspaceKey],
  );

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

  const renderSection = useCallback(
    (id: RailDecidedSectionId, index: number) => {
      const divided = index > 0;
      const open = isSectionOpen(closedSections, id);
      switch (id) {
        case "tasks":
          return (
            <TasksSection
              key={id}
              tasks={tasks ?? EMPTY_TASKS}
              divided={divided}
              open={open}
              onToggle={handleToggleTasks}
            />
          );
        case "changes":
          return (
            <ChangedFilesSection
              key={id}
              files={changedFiles}
              divided={divided}
              isExpanded={open}
              onToggleExpanded={handleToggleChanges}
              expandedFilePaths={expandedFilePaths}
              onToggleFile={handleToggleChangedFile}
              openFile={handleOpenChangedFile}
            />
          );
        case "artifacts":
          return (
            <ArtifactsSection
              key={id}
              artifacts={sessionDerived.artifacts}
              divided={divided}
              isExpanded={open}
              onToggleExpanded={handleToggleArtifacts}
              onOpenArtifact={handleOpenFile}
            />
          );
        case "sources":
          return (
            <SourcesSection
              key={id}
              webSources={sessionDerived.webSources}
              projectFiles={sessionDerived.projectFiles}
              uploadedCount={uploadedCount}
              divided={divided}
              isExpanded={open}
              onToggleExpanded={handleToggleSources}
              onOpenWebSource={handleOpenWebSource}
              onOpenProjectFile={handleOpenFile}
            />
          );
        case "skills":
          return (
            <SkillsSection
              key={id}
              skills={sessionDerived.skills}
              divided={divided}
              isExpanded={open}
              onToggleExpanded={handleToggleSkills}
            />
          );
        case "environment":
          return git ? (
            <EnvironmentSection
              key={id}
              serverId={serverId}
              cwd={cwd}
              workspaceId={workspaceId}
              git={git}
              divided={divided}
              open={open}
              onToggle={handleToggleEnvironment}
            />
          ) : null;
        case "commits":
          return (
            <CommitsSection
              key={id}
              commits={commits}
              divided={divided}
              open={open}
              onToggle={handleToggleCommits}
            />
          );
      }
    },
    [
      changedFiles,
      closedSections,
      commits,
      cwd,
      expandedFilePaths,
      git,
      handleOpenChangedFile,
      handleOpenFile,
      handleOpenWebSource,
      handleToggleArtifacts,
      handleToggleChangedFile,
      handleToggleChanges,
      handleToggleCommits,
      handleToggleEnvironment,
      handleToggleSkills,
      handleToggleSources,
      handleToggleTasks,
      serverId,
      sessionDerived,
      tasks,
      uploadedCount,
      workspaceId,
    ],
  );

  if (collapsed) {
    return (
      <View style={styles.slot} pointerEvents="box-none">
        <Pressable
          onPress={toggleCollapsed}
          style={styles.collapsedTab}
          accessibilityRole="button"
          accessibilityLabel={t("workspace.git.rail.expand")}
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
        {/* The reference panel puts nothing above its first section but a way to dismiss it, so
            this strip carries the collapse control and no title of its own. */}
        <View style={styles.header}>
          <Pressable
            onPress={toggleCollapsed}
            style={styles.headerButton}
            accessibilityRole="button"
            accessibilityLabel={t("workspace.git.rail.collapse")}
            testID="workspace-rail-collapse"
          >
            <ThemedChevronRight size={14} uniProps={mutedColorMapping} />
          </Pressable>
        </View>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          {visibleSections.map(renderSection)}
          {agentId ? (
            <SubagentsSection
              serverId={serverId}
              parentAgentId={agentId}
              divided={visibleSections.length > 0}
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
    // `centerContent` is full height and the workspace's tab row is painted over its top edge, so
    // the rail has to clear that band by hand — flush to the top it covers the row's own actions.
    top: WORKSPACE_SECONDARY_HEADER_HEIGHT + theme.spacing[3],
    right: theme.spacing[3],
    // Top and bottom together give the slot a definite height, which is what lets the panel's
    // `maxHeight` and the scroll view inside it resolve. A `maxHeight` on an auto-sized slot does
    // not: the panel measures past it and the sections run off the bottom of the window.
    bottom: theme.spacing[6],
    width: 288,
  },
  panel: {
    maxHeight: "100%",
    backgroundColor: theme.colors.surface1,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.xl,
    ...theme.shadow.md,
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
    borderColor: theme.colors.border,
    borderRightWidth: 0,
    borderTopLeftRadius: theme.borderRadius.md,
    borderBottomLeftRadius: theme.borderRadius.md,
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[1],
    ...theme.shadow.md,
  },
}));
