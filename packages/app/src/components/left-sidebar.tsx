import { router } from "expo-router";
import {
  Bell,
  BellRing,
  Import,
  Search,
  Server,
  Settings,
  X,
  type LucideIcon,
} from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  Pressable,
  StyleSheet as RNStyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { Gesture } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { TitlebarDragRegion } from "@/components/desktop/titlebar-drag-region";
import { resolveDesktopSidebarWidth } from "@/components/desktop-sidebar-layout";
import {
  SIDEBAR_TOGGLE_DURATION_MS,
  SIDEBAR_TOGGLE_EASING,
} from "@/components/sidebar-toggle-animation";
import {
  SIDEBAR_RESIZE_ACTIVATION_OFFSET,
  SIDEBAR_RESIZE_FAIL_OFFSET,
} from "@/components/sidebar-resize-handle-layout";
import { HostPicker } from "@/components/hosts/host-picker";
import { SidebarDisplayPreferencesMenu } from "@/components/sidebar/display-preferences/menu";
import { SidebarNavRows } from "@/components/sidebar/sidebar-nav-rows";
import { SidebarHelpMenu } from "@/components/sidebar/sidebar-help-menu";
import { SidebarResizeHandle } from "@/components/sidebar-resize-handle";
import { Shortcut } from "@/components/ui/shortcut";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { HEADER_INNER_HEIGHT, useIsCompactFormFactor } from "@/constants/layout";
import { useOpenAddProject } from "@/hooks/use-open-add-project";
import { useImportSession } from "@/hooks/use-import-session";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import { useAggregatedAgents } from "@/hooks/use-aggregated-agents";
import {
  type SidebarProjectEntry,
  type SidebarWorkspaceEntry,
} from "@/hooks/use-sidebar-workspaces-list";
import { useSidebarModel } from "@/components/sidebar/sidebar-model";
import {
  builtinSidebarNavLabelKey,
  builtinSidebarNavShortcutAction,
  isSidebarHeaderNavItem,
} from "@/sidebar-nav/model";
import { useSidebarNavItems } from "@/sidebar-nav/use-sidebar-nav-items";
import type { PinnedSidebarGroups } from "@/hooks/use-sidebar-pins";
import { RetainedPanelActivity } from "@/components/retained-panel";
import type { SidebarWorkspaceGroup } from "@/components/sidebar/sidebar-labels";
import type { SidebarProjectIconTarget } from "@/utils/sidebar-project-row-model";
import { type SidebarGroupMode, useSidebarViewStore } from "@/stores/sidebar-view-store";
import { useHosts } from "@/runtime/host-runtime";
import { usePanelStore } from "@/stores/panel-store";
import { useKeyboardShortcutsStore } from "@/stores/keyboard-shortcuts-store";
import { useOwnsWindowChromeCorner, WindowChromeSafeArea } from "@/utils/desktop-window";
import { useCloseAgentListGesture } from "@/mobile-panels/gestures";
import { MobilePanelOverlay } from "@/mobile-panels/presentation";
import { buildSettingsAddHostRoute, buildSettingsRoute } from "@/utils/host-routes";
import { openHostOverview } from "@/navigation/settings-navigation";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { pickSessionActivityTarget } from "@/utils/session-activity-target";
import { SidebarAgentListSkeleton } from "./sidebar-agent-list-skeleton";
import { SidebarCalloutSlot } from "./sidebar-callout-slot";
import { SidebarWorkspaceList } from "./sidebar-workspace-list";

type SidebarTheme = ReturnType<typeof useUnistyles>["theme"];

interface SidebarSharedProps {
  theme: SidebarTheme;
  workspaceGroups: SidebarWorkspaceGroup[];
  projectIconTargets: SidebarProjectIconTarget[];
  pinnedGroups: PinnedSidebarGroups;
  projects: SidebarProjectEntry[];
  hasProjectsBeforeFilter: boolean;
  hasActiveProjectFilter: boolean;
  workspaceEntriesByKey: ReadonlyMap<string, SidebarWorkspaceEntry>;
  isInitialLoad: boolean;
  isRevalidating: boolean;
  isManualRefresh: boolean;
  groupMode: SidebarGroupMode;
  collapsedProjectKeys: ReadonlySet<string>;
  shortcutIndexByWorkspaceKey: Map<string, number>;
  toggleProjectCollapsed: (projectViewKey: string) => void;
  handleRefresh: () => void;
  handleOpenProject: () => void;
  handleImportSession: () => void;
  handleSettings: () => void;
  labels: SidebarLabels;
  handleAddHost: () => void;
  handleOpenHostSettings: (serverId: string) => void;
}

interface SidebarLabels {
  hosts: string;
  importSession: string;
  settings: string;
  closeSidebar: string;
}

interface MobileSidebarProps extends SidebarSharedProps {
  active: boolean;
  insetsTop: number;
  insetsBottom: number;
  closeSidebar: () => void;
}

interface DesktopSidebarProps extends SidebarSharedProps {
  insetsTop: number;
  active: boolean;
}

export const LeftSidebar = memo(function LeftSidebar({ active }: { active: boolean }) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const isCompactLayout = useIsCompactFormFactor();
  const showMobileAgent = usePanelStore((state) => state.showMobileAgent);

  const {
    projects,
    hasProjectsBeforeFilter,
    resolvedProjectFilters,
    workspaceEntriesByKey,
    isInitialLoad,
    isRevalidating,
    refreshAll,
    workspaceGroups,
    projectIconTargets,
    pinnedGroups,
    collapsedProjectKeys,
    toggleProjectCollapsed,
    groupMode,
    shortcutModel,
  } = useSidebarModel();
  const { shortcutIndexByWorkspaceKey } = shortcutModel;

  const [isManualRefresh, setIsManualRefresh] = useState(false);

  const handleRefresh = useCallback(() => {
    setIsManualRefresh(true);
    refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    if (!isRevalidating && isManualRefresh) {
      setIsManualRefresh(false);
    }
  }, [isRevalidating, isManualRefresh]);

  const openProjectPicker = useOpenAddProject();
  const { open: openImportSession, sheet: importSessionSheet } = useImportSession();

  const handleOpenProjectMobile = useCallback(() => {
    showMobileAgent();
    void openProjectPicker();
  }, [showMobileAgent, openProjectPicker]);

  const handleOpenProjectDesktop = useCallback(() => {
    void openProjectPicker();
  }, [openProjectPicker]);

  const handleSettingsMobile = useCallback(() => {
    showMobileAgent();
    router.push(buildSettingsRoute());
  }, [showMobileAgent]);

  const handleSettingsDesktop = useCallback(() => {
    router.push(buildSettingsRoute());
  }, []);

  const handleAddHostMobile = useCallback(() => {
    showMobileAgent();
    router.push(buildSettingsAddHostRoute(Date.now()));
  }, [showMobileAgent]);

  const handleAddHostDesktop = useCallback(() => {
    router.push(buildSettingsAddHostRoute(Date.now()));
  }, []);

  const handleOpenHostSettingsMobile = useCallback(
    (serverId: string) => {
      showMobileAgent();
      openHostOverview(serverId);
    },
    [showMobileAgent],
  );

  const handleOpenHostSettingsDesktop = useCallback((serverId: string) => {
    openHostOverview(serverId);
  }, []);

  const handleImportSessionMobile = useCallback(() => {
    showMobileAgent();
    openImportSession();
  }, [openImportSession, showMobileAgent]);

  const labels = useMemo(
    (): SidebarLabels => ({
      hosts: t("sidebar.actions.hosts"),
      importSession: t("importSession.title"),
      settings: t("sidebar.actions.settings"),
      closeSidebar: t("sidebar.actions.closeSidebar"),
    }),
    [t],
  );

  const sharedProps = {
    theme,
    workspaceGroups,
    projectIconTargets,
    pinnedGroups,
    projects,
    hasProjectsBeforeFilter,
    hasActiveProjectFilter: resolvedProjectFilters.length > 0,
    workspaceEntriesByKey,
    isInitialLoad,
    isRevalidating,
    isManualRefresh,
    groupMode,
    collapsedProjectKeys,
    shortcutIndexByWorkspaceKey,
    toggleProjectCollapsed,
    handleRefresh,
    labels,
  };

  if (isCompactLayout) {
    return (
      <>
        <RetainedPanelActivity active={active}>
          <MobileSidebar
            {...sharedProps}
            active={active}
            insetsTop={insets.top}
            insetsBottom={insets.bottom}
            closeSidebar={showMobileAgent}
            handleOpenProject={handleOpenProjectMobile}
            handleImportSession={handleImportSessionMobile}
            handleSettings={handleSettingsMobile}
            handleAddHost={handleAddHostMobile}
            handleOpenHostSettings={handleOpenHostSettingsMobile}
          />
        </RetainedPanelActivity>
        {importSessionSheet}
      </>
    );
  }

  return (
    <>
      <RetainedPanelActivity active={active}>
        <DesktopSidebar
          {...sharedProps}
          insetsTop={insets.top}
          active={active}
          handleOpenProject={handleOpenProjectDesktop}
          handleImportSession={openImportSession}
          handleSettings={handleSettingsDesktop}
          handleAddHost={handleAddHostDesktop}
          handleOpenHostSettings={handleOpenHostSettingsDesktop}
        />
      </RetainedPanelActivity>
      {importSessionSheet}
    </>
  );
});

function sidebarHostOptionTestID(serverId: string): string {
  return `sidebar-host-row-${serverId}`;
}

function FooterIconButton({
  buttonRef,
  onPress,
  testID,
  label,
  icon: Icon,
  iconSize,
  shortcutKeys,
  theme,
}: {
  onPress: () => void;
  testID: string;
  label: string;
  icon: typeof Import;
  iconSize?: number;
  shortcutKeys?: ReturnType<typeof useShortcutKeys>;
  theme: SidebarTheme;
  buttonRef?: RefObject<View | null>;
}) {
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <Pressable
          ref={buttonRef}
          style={styles.footerIconButton}
          testID={testID}
          nativeID={testID}
          collapsable={false}
          accessible
          accessibilityLabel={label}
          accessibilityRole="button"
          onPress={onPress}
        >
          {({ hovered }) => (
            <Icon
              size={iconSize ?? theme.iconSize.md}
              color={hovered ? theme.colors.foreground : theme.colors.foregroundMuted}
            />
          )}
        </Pressable>
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={8}>
        <IconTooltipContent label={label} shortcutKeys={shortcutKeys} />
      </TooltipContent>
    </Tooltip>
  );
}

function SidebarHostPicker({
  theme,
  label,
  onAddHost,
  onOpenHostSettings,
  avatarMode = false,
}: {
  theme: SidebarTheme;
  label: string;
  onAddHost: () => void;
  onOpenHostSettings: (serverId: string) => void;
  avatarMode?: boolean;
}) {
  const hosts = useHosts();
  const triggerRef = useRef<View | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const handleSelect = useCallback(
    (id: string) => {
      onOpenHostSettings(id);
    },
    [onOpenHostSettings],
  );

  const handleOpen = useCallback(() => setIsOpen(true), []);

  const trigger = avatarMode ? (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <Pressable
          ref={triggerRef}
          style={styles.footerAvatar}
          testID="sidebar-hosts-trigger"
          nativeID="sidebar-hosts-trigger"
          collapsable={false}
          accessible
          accessibilityLabel={label}
          accessibilityRole="button"
          onPress={handleOpen}
        >
          {({ hovered }) => (
            <Server
              size={theme.iconSize.sm}
              color={hovered ? theme.colors.foreground : theme.colors.foregroundMuted}
            />
          )}
        </Pressable>
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={8}>
        <Text style={styles.tooltipText}>{label}</Text>
      </TooltipContent>
    </Tooltip>
  ) : (
    <FooterIconButton
      buttonRef={triggerRef}
      onPress={handleOpen}
      testID="sidebar-hosts-trigger"
      label={label}
      icon={Server}
      iconSize={theme.iconSize.sm}
      theme={theme}
    />
  );

  return (
    <HostPicker
      hosts={hosts}
      value=""
      onSelect={handleSelect}
      open={isOpen}
      onOpenChange={setIsOpen}
      anchorRef={triggerRef}
      includeAddHost
      onAddHost={onAddHost}
      showActiveConnection
      onOpenHostSettings={onOpenHostSettings}
      searchable
      desktopPlacement="top-start"
      desktopMinWidth={180}
      addHostTestID="sidebar-host-add"
      hostOptionTestID={sidebarHostOptionTestID}
    >
      {trigger}
    </HostPicker>
  );
}

function IconTooltipContent({
  label,
  shortcutKeys,
}: {
  label: string;
  shortcutKeys?: ReturnType<typeof useShortcutKeys>;
}) {
  return (
    <View style={styles.tooltipRow}>
      <Text style={styles.tooltipText}>{label}</Text>
      {shortcutKeys ? <Shortcut chord={shortcutKeys} /> : null}
    </View>
  );
}

function SidebarFooter({
  theme,
  handleImportSession,
  handleSettings,
  labels,
  handleAddHost,
  handleOpenHostSettings,
}: {
  theme: SidebarTheme;
  handleImportSession: () => void;
  handleSettings: () => void;
  labels: {
    hosts: string;
    importSession: string;
    settings: string;
  };
  handleAddHost: () => void;
  handleOpenHostSettings: (serverId: string) => void;
}) {
  const settingsKeys = useShortcutKeys("toggle-settings");

  return (
    <View style={styles.sidebarFooter}>
      <SidebarHostPicker
        theme={theme}
        label={labels.hosts}
        onAddHost={handleAddHost}
        onOpenHostSettings={handleOpenHostSettings}
        avatarMode
      />
      <View style={styles.footerSpacer} />
      <View style={styles.footerIconRow}>
        <FooterIconButton
          onPress={handleImportSession}
          testID="sidebar-import-session"
          label={labels.importSession}
          icon={Import}
          theme={theme}
        />
        <SidebarHelpMenu />
        <FooterIconButton
          onPress={handleSettings}
          testID="sidebar-settings"
          label={labels.settings}
          icon={Settings}
          shortcutKeys={settingsKeys}
          theme={theme}
        />
      </View>
    </View>
  );
}

function MobileSidebar({
  active,
  theme,
  workspaceGroups,
  projectIconTargets,
  pinnedGroups,
  projects,
  hasProjectsBeforeFilter,
  hasActiveProjectFilter,
  workspaceEntriesByKey,
  isInitialLoad,
  isRevalidating,
  isManualRefresh,
  groupMode,
  collapsedProjectKeys,
  shortcutIndexByWorkspaceKey,
  toggleProjectCollapsed,
  handleRefresh,
  handleOpenProject,
  handleImportSession,
  handleSettings,
  labels,
  handleAddHost,
  handleOpenHostSettings,
  insetsTop,
  insetsBottom,
  closeSidebar,
}: MobileSidebarProps) {
  const hasActiveHostFilter = useSidebarViewStore((state) => state.hostFilters.length > 0);
  const { gesture: closeGesture, gestureRef: closeGestureRef } = useCloseAgentListGesture();

  const handleWorkspacePress = useCallback(() => {
    closeSidebar();
  }, [closeSidebar]);

  const mobileSidebarInsetStyle = useMemo(
    () => ({
      paddingTop: insetsTop,
      paddingBottom: insetsBottom,
      backgroundColor: theme.colors.surfaceSidebar,
    }),
    [insetsTop, insetsBottom, theme.colors.surfaceSidebar],
  );

  const mobileScrollableNavElement = useMemo(
    () => (
      <SidebarNavRows
        mode="scrollable"
        style={styles.sidebarScrollableNavGroup}
        onBeforeNavigate={closeSidebar}
      />
    ),
    [closeSidebar],
  );

  return (
    <MobilePanelOverlay
      panel="agent-list"
      closeGesture={closeGesture}
      panelStyle={mobileSidebarInsetStyle}
    >
      <View style={styles.sidebarContent} pointerEvents="auto">
        <View style={styles.mobilePinnedArea}>
          <WindowChromeSafeArea placement="below" />
          <SidebarBrandHeader closeSidebar={closeSidebar} closeLabel={labels.closeSidebar} />
          <SidebarNavRows
            mode="pinned"
            style={styles.sidebarHeaderGroup}
            onBeforeNavigate={closeSidebar}
          />
        </View>

        {isInitialLoad && !hasActiveHostFilter ? (
          <View style={styles.sidebarContent}>
            <SidebarNavRows
              mode="scrollable"
              style={styles.sidebarScrollableNavGroupFlush}
              onBeforeNavigate={closeSidebar}
            />
            <SidebarAgentListSkeleton />
          </View>
        ) : (
          <SidebarWorkspaceList
            collapsedProjectKeys={collapsedProjectKeys}
            onToggleProjectCollapsed={toggleProjectCollapsed}
            shortcutIndexByWorkspaceKey={shortcutIndexByWorkspaceKey}
            groupMode={groupMode}
            workspaceGroups={workspaceGroups}
            projectIconTargets={projectIconTargets}
            pinnedGroups={pinnedGroups}
            projects={projects}
            hasProjectsBeforeFilter={hasProjectsBeforeFilter}
            hasActiveProjectFilter={hasActiveProjectFilter}
            workspaceEntriesByKey={workspaceEntriesByKey}
            isRefreshing={isManualRefresh && isRevalidating}
            onRefresh={handleRefresh}
            onWorkspacePress={handleWorkspacePress}
            onAddProject={handleOpenProject}
            onImportSession={handleImportSession}
            parentGestureRef={closeGestureRef}
            dragGestureHostActive={active}
            listTopComponent={mobileScrollableNavElement}
            listHeaderComponent={workspacesSectionHeaderElement}
          />
        )}

        <SidebarFooter
          theme={theme}
          handleImportSession={handleImportSession}
          handleSettings={handleSettings}
          labels={labels}
          handleAddHost={handleAddHost}
          handleOpenHostSettings={handleOpenHostSettings}
        />
      </View>
    </MobilePanelOverlay>
  );
}

function DesktopSidebar({
  theme,
  workspaceGroups,
  projectIconTargets,
  pinnedGroups,
  projects,
  hasProjectsBeforeFilter,
  hasActiveProjectFilter,
  workspaceEntriesByKey,
  isInitialLoad,
  isRevalidating,
  isManualRefresh,
  groupMode,
  collapsedProjectKeys,
  shortcutIndexByWorkspaceKey,
  toggleProjectCollapsed,
  handleRefresh,
  handleOpenProject,
  handleImportSession,
  handleSettings,
  labels,
  handleAddHost,
  handleOpenHostSettings,
  insetsTop,
  active,
}: DesktopSidebarProps) {
  const ownsTopLeft = useOwnsWindowChromeCorner("top-left");
  const hasActiveHostFilter = useSidebarViewStore((state) => state.hostFilters.length > 0);
  const sidebarWidth = usePanelStore((state) => state.sidebarWidth);
  const setSidebarWidth = usePanelStore((state) => state.setSidebarWidth);
  const { width: viewportWidth } = useWindowDimensions();
  const visibleSidebarWidth = resolveDesktopSidebarWidth({
    requestedWidth: sidebarWidth,
    viewportWidth,
  });

  const startWidthRef = useRef(visibleSidebarWidth);
  const resizeWidth = useSharedValue(active ? visibleSidebarWidth : 0);
  const prevActiveRef = useRef(active);
  const [resizePressed, setResizePressed] = useState(false);
  const showResizeGrip = useCallback(() => setResizePressed(true), []);
  const hideResizeGrip = useCallback(() => setResizePressed(false), []);

  // Open/close animates width so the sidebar slides instead of display:none.
  // While already open, width snaps (viewport resize, post-drag store commit).
  useEffect(() => {
    if (!active) {
      resizeWidth.value = withTiming(0, {
        duration: SIDEBAR_TOGGLE_DURATION_MS,
        easing: SIDEBAR_TOGGLE_EASING,
      });
    } else if (prevActiveRef.current) {
      resizeWidth.value = visibleSidebarWidth;
    } else {
      resizeWidth.value = withTiming(visibleSidebarWidth, {
        duration: SIDEBAR_TOGGLE_DURATION_MS,
        easing: SIDEBAR_TOGGLE_EASING,
      });
    }
    prevActiveRef.current = active;
  }, [active, resizeWidth, visibleSidebarWidth]);

  const resizeGesture = useMemo(
    () =>
      Gesture.Pan()
        .hitSlop({ left: 8, right: 8, top: 0, bottom: 0 })
        .onBegin(() => {
          scheduleOnRN(showResizeGrip);
        })
        // Horizontal intent only, so a finger dragging down the touch grip scrolls
        // the workspace list instead of resizing. Anchoring the start width to the
        // activation translation keeps the extra threshold from jumping the edge.
        .activeOffsetX([-SIDEBAR_RESIZE_ACTIVATION_OFFSET, SIDEBAR_RESIZE_ACTIVATION_OFFSET])
        .failOffsetY([-SIDEBAR_RESIZE_FAIL_OFFSET, SIDEBAR_RESIZE_FAIL_OFFSET])
        .onStart((event) => {
          startWidthRef.current = visibleSidebarWidth - event.translationX;
          resizeWidth.value = visibleSidebarWidth;
        })
        .onUpdate((event) => {
          // Dragging right (positive translationX) increases width
          const newWidth = startWidthRef.current + event.translationX;
          resizeWidth.value = resolveDesktopSidebarWidth({
            requestedWidth: newWidth,
            viewportWidth,
          });
        })
        .onEnd(() => {
          runOnJS(setSidebarWidth)(resizeWidth.value);
        })
        .onFinalize(() => {
          scheduleOnRN(hideResizeGrip);
        }),
    [
      hideResizeGrip,
      resizeWidth,
      setSidebarWidth,
      showResizeGrip,
      viewportWidth,
      visibleSidebarWidth,
    ],
  );

  const resizeAnimatedStyle = useAnimatedStyle(() => ({
    width: resizeWidth.value,
  }));

  const desktopSidebarStyle = useMemo(
    () => [staticStyles.desktopSidebar, resizeAnimatedStyle],
    [resizeAnimatedStyle],
  );
  const desktopSidebarBorderStyle = useMemo(
    () => [styles.desktopSidebarBorder, { flex: 1, paddingTop: insetsTop }],
    [insetsTop],
  );
  const sidebarHeaderGroupStyle = useMemo(
    () => [styles.sidebarHeaderGroup, ownsTopLeft && styles.sidebarHeaderGroupBelowChrome],
    [ownsTopLeft],
  );

  const desktopScrollableNavElement = useMemo(
    () => <SidebarNavRows mode="scrollable" style={styles.sidebarScrollableNavGroup} />,
    [],
  );

  return (
    <Animated.View
      accessibilityElementsHidden={!active}
      importantForAccessibility={active ? "auto" : "no-hide-descendants"}
      pointerEvents={active ? "auto" : "none"}
      style={desktopSidebarStyle}
    >
      <View style={desktopSidebarBorderStyle}>
        <View style={styles.sidebarDragArea}>
          {ownsTopLeft ? (
            <View style={styles.desktopChromeRow}>
              <TitlebarDragRegion />
            </View>
          ) : (
            <TitlebarDragRegion />
          )}
          <SidebarBrandHeader />
          <SidebarNavRows mode="pinned" style={sidebarHeaderGroupStyle} />
        </View>

        {isInitialLoad && !hasActiveHostFilter ? (
          <View style={styles.sidebarContent}>
            <SidebarNavRows mode="scrollable" style={styles.sidebarScrollableNavGroupFlush} />
            <SidebarAgentListSkeleton />
          </View>
        ) : (
          <SidebarWorkspaceList
            collapsedProjectKeys={collapsedProjectKeys}
            onToggleProjectCollapsed={toggleProjectCollapsed}
            shortcutIndexByWorkspaceKey={shortcutIndexByWorkspaceKey}
            groupMode={groupMode}
            workspaceGroups={workspaceGroups}
            projectIconTargets={projectIconTargets}
            pinnedGroups={pinnedGroups}
            projects={projects}
            hasProjectsBeforeFilter={hasProjectsBeforeFilter}
            hasActiveProjectFilter={hasActiveProjectFilter}
            workspaceEntriesByKey={workspaceEntriesByKey}
            isRefreshing={isManualRefresh && isRevalidating}
            onRefresh={handleRefresh}
            onAddProject={handleOpenProject}
            onImportSession={handleImportSession}
            listTopComponent={desktopScrollableNavElement}
            listHeaderComponent={workspacesSectionHeaderElement}
          />
        )}

        <SidebarCalloutSlot />

        <SidebarFooter
          theme={theme}
          handleImportSession={handleImportSession}
          handleSettings={handleSettings}
          labels={labels}
          handleAddHost={handleAddHost}
          handleOpenHostSettings={handleOpenHostSettings}
        />

        <SidebarResizeHandle
          edge="right"
          gesture={resizeGesture}
          pressed={resizePressed}
          testID="left-sidebar-resize-handle"
        />
      </View>
    </Animated.View>
  );
}

function SidebarHeaderIconButton({
  icon: Icon,
  label,
  onPress,
  testID,
  theme,
  disabled = false,
  shortcutKeys,
}: {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  testID: string;
  theme: SidebarTheme;
  disabled?: boolean;
  shortcutKeys?: ReturnType<typeof useShortcutKeys>;
}) {
  const resolveIconColor = (active: boolean): string => {
    if (disabled) return theme.colors.border;
    if (active) return theme.colors.foreground;
    return theme.colors.foregroundMuted;
  };

  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <Pressable
          style={styles.headerIconButton}
          onPress={onPress}
          disabled={disabled}
          testID={testID}
          nativeID={testID}
          accessible
          accessibilityRole="button"
          accessibilityLabel={label}
          hitSlop={4}
        >
          {({ hovered, pressed }) => (
            <Icon size={theme.iconSize.md} color={resolveIconColor(hovered || pressed)} />
          )}
        </Pressable>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="center" offset={8}>
        <IconTooltipContent label={label} shortcutKeys={shortcutKeys} />
      </TooltipContent>
    </Tooltip>
  );
}

function SidebarBrandHeader({
  closeSidebar,
  closeLabel,
}: {
  closeSidebar?: () => void;
  closeLabel?: string;
}) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const { items } = useSidebarNavItems();
  const { agents } = useAggregatedAgents();
  const setCommandCenterOpen = useKeyboardShortcutsStore((state) => state.setCommandCenterOpen);
  const searchKeys = useShortcutKeys(builtinSidebarNavShortcutAction("search"));
  const showSearch = items.some((item) => item.visible && isSidebarHeaderNavItem(item));
  const activityTarget = useMemo(() => pickSessionActivityTarget(agents), [agents]);
  const ActivityIcon = activityTarget?.kind === "attention" ? BellRing : Bell;
  const handleSearch = useCallback(() => setCommandCenterOpen(true), [setCommandCenterOpen]);
  const handleActivity = useCallback(() => {
    if (!activityTarget) return;
    closeSidebar?.();
    navigateToAgent({
      serverId: activityTarget.agent.serverId,
      agentId: activityTarget.agent.id,
      workspaceId: activityTarget.agent.workspaceId,
      pin: true,
    });
  }, [activityTarget, closeSidebar]);

  return (
    <View style={styles.brandHeader}>
      <Text style={styles.brandTitle}>Paimon</Text>
      <View style={styles.brandActions}>
        {showSearch ? (
          <SidebarHeaderIconButton
            icon={Search}
            label={t(builtinSidebarNavLabelKey("search"))}
            onPress={handleSearch}
            testID="sidebar-header-search"
            theme={theme}
            shortcutKeys={searchKeys}
          />
        ) : null}
        <SidebarHeaderIconButton
          icon={ActivityIcon}
          label={t("sidebar.actions.jumpToActivity")}
          onPress={handleActivity}
          testID="sidebar-header-activity"
          theme={theme}
          disabled={!activityTarget}
        />
        {closeSidebar && closeLabel ? (
          <SidebarHeaderIconButton
            icon={X}
            label={closeLabel}
            onPress={closeSidebar}
            testID="sidebar-close"
            theme={theme}
          />
        ) : null}
      </View>
    </View>
  );
}

function WorkspacesSectionHeader() {
  return (
    <View style={styles.workspacesSectionHeader}>
      <Text style={styles.workspacesSectionTitle}>Workspaces</Text>
      <View style={styles.workspacesSectionActions}>
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            <View>
              <SidebarDisplayPreferencesMenu />
            </View>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="center" offset={8}>
            <IconTooltipContent label="Display preferences" />
          </TooltipContent>
        </Tooltip>
      </View>
    </View>
  );
}

// Stable element so the sidebar list's listHeaderComponent prop keeps identity across
// renders (WorkspacesSectionHeader takes no props).
const workspacesSectionHeaderElement = <WorkspacesSectionHeader />;

// Static styles for Animated.Views — must NOT use Unistyles dynamic theme to
// avoid the "Unable to find node on an unmounted component" crash when Unistyles
// tries to patch the native node that Reanimated also manages.
const staticStyles = RNStyleSheet.create({
  desktopSidebar: {
    position: "relative" as const,
    // Width animates to 0 on close; clip so content does not paint past the rail.
    overflow: "hidden" as const,
  },
});

const styles = StyleSheet.create((theme) => ({
  sidebarHeaderGroup: {
    paddingTop: theme.spacing[2],
    gap: 2,
    paddingBottom: theme.spacing[1.5],
    borderBottomWidth: 0,
  },
  sidebarHeaderGroupBelowChrome: {
    paddingTop: 0,
  },
  workspacesSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    // Rendered inside the scroll's listContent (paddingHorizontal spacing[2]). The title
    // lands at spacing[2] left to align with project icons. Settings2's painted path stops
    // inside its 14px SVG, so 4px aligns the ink rather than the SVG box to the row rail.
    paddingLeft: theme.spacing[2],
    paddingRight: 4,
    paddingTop: theme.spacing[1],
    paddingBottom: theme.spacing[1],
  },
  workspacesSectionTitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
  },
  workspacesSectionActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  sidebarContent: {
    flex: 1,
    minHeight: 0,
  },
  sidebarScrollableNavGroup: {
    marginHorizontal: -theme.spacing[2],
    gap: 2,
    paddingBottom: theme.spacing[1.5],
  },
  sidebarScrollableNavGroupFlush: {
    gap: 2,
    paddingBottom: theme.spacing[1.5],
  },
  mobilePinnedArea: {
    position: "relative",
    zIndex: 1,
    backgroundColor: theme.colors.surfaceSidebar,
  },
  desktopSidebarBorder: {
    borderRightWidth: 0,
    backgroundColor: theme.colors.surfaceSidebar,
  },
  sidebarDragArea: {
    position: "relative",
    zIndex: 1,
    backgroundColor: theme.colors.surfaceSidebar,
  },
  desktopChromeRow: {
    position: "relative",
    height: HEADER_INNER_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    paddingHorizontal: theme.spacing[3],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: "transparent",
  },
  devBuildBadge: {
    maxWidth: "60%",
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 2,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.accent,
  },
  devBuildBadgeText: {
    minWidth: 0,
    flexShrink: 1,
    color: theme.colors.accentForeground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  sidebarFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    paddingTop: theme.spacing[3],
    paddingBottom: theme.spacing[3],
    borderTopWidth: 0,
  },
  footerSpacer: {
    flex: 1,
  },
  footerIconRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flexShrink: 0,
  },
  footerIconButton: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[1],
  },
  tooltipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  tooltipText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.popoverForeground,
  },
  // Brand header — shows "Paimon" at the top of the desktop sidebar
  brandHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[2],
    borderBottomWidth: 0,
  },
  brandTitle: {
    fontSize: 16,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
    letterSpacing: -0.2,
    flex: 1,
  },
  brandActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flexShrink: 0,
  },
  headerIconButton: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.lg,
  },
  // Footer avatar — circular host indicator on the left of the footer bar
  footerAvatar: {
    width: 32,
    height: 32,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface3,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
}));
