import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Portal } from "@gorhom/portal";
import {
  ArrowUpFromLine,
  Check,
  ChevronDown,
  GitBranch,
  GitCommit,
  Sparkles,
  UploadCloud,
} from "lucide-react-native";
import { AdaptiveTextInput } from "@/components/adaptive-text-input";
import { BranchSwitcher } from "@/components/branch-switcher";
import { DiffStat } from "@/components/diff-stat";
import { FloatingSurface } from "@/components/ui/floating";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useToast } from "@/contexts/toast-context";
import { useCheckoutGitActionsStore } from "@/git/actions-store";
import { getOverlayRoot, OverlayLayerProvider, useOverlayLayer } from "@/lib/overlay-root";
import { useHostFeature } from "@/runtime/host-features";
import { isWeb } from "@/constants/platform";
import { type RailGitState } from "@/workspace-rail/rail-state";
import { type Theme } from "@/styles/theme";

const ThemedGitBranch = withUnistyles(GitBranch);
const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedGitCommit = withUnistyles(GitCommit);
const ThemedUploadCloud = withUnistyles(UploadCloud);
const ThemedArrowUpFromLine = withUnistyles(ArrowUpFromLine);
const ThemedCheck = withUnistyles(Check);
const ThemedSparkles = withUnistyles(Sparkles);

const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const successColorMapping = (theme: Theme) => ({ color: theme.colors.statusSuccess });
const accentColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });

export interface GitFlyoutAnchorRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GitFlyoutProps {
  serverId: string;
  workspaceId: string;
  cwd: string;
  git: RailGitState;
  diffStat?: { additions: number; deletions: number } | null;
  isOpen: boolean;
  onClose: () => void;
  anchorRect?: GitFlyoutAnchorRect | null;
}

const FLYOUT_WIDTH = 320;
const FLYOUT_ESTIMATED_HEIGHT = 300;

function GitFlyoutBranchHeader({
  branchName,
  serverId,
  workspaceId,
  cwd,
}: {
  branchName: string;
  serverId: string;
  workspaceId: string;
  cwd: string;
}) {
  const { t } = useTranslation();

  const branchRowStyle = useCallback(
    ({ pressed, hovered }: { pressed?: boolean; hovered?: boolean }) => [
      styles.branchRow,
      hovered && styles.branchRowHovered,
      pressed && styles.branchRowPressed,
    ],
    [],
  );

  const renderBranchTrigger = useCallback(
    ({ onPress, label, testID }: { onPress: () => void; label: string; testID?: string }) => (
      <Pressable
        onPress={onPress}
        style={branchRowStyle}
        accessibilityRole="button"
        accessibilityLabel={t("branchSwitcher.currentBranch", { branchName: label })}
        testID={testID}
      >
        <View style={styles.branchRowLeft}>
          <ThemedGitBranch size={14} uniProps={mutedColorMapping} />
          <Text style={styles.branchText} numberOfLines={1}>
            {label}
          </Text>
        </View>
        <ThemedChevronDown size={14} uniProps={mutedColorMapping} />
      </Pressable>
    ),
    [branchRowStyle, t],
  );

  return (
    <BranchSwitcher
      currentBranchName={branchName}
      serverId={serverId}
      workspaceId={workspaceId}
      workspaceDirectory={cwd}
      isGitCheckout
      testID="git-flyout-branch-switcher"
      desktopPlacement="bottom-start"
      containerStyle={styles.branchSwitcherAnchor}
      renderTrigger={renderBranchTrigger}
    />
  );
}

function GitFlyoutInput({
  message,
  resetKey,
  isBusy,
  isGenerating,
  supportsGenerate,
  onChangeText,
  onGenerate,
}: {
  message: string;
  resetKey: number;
  isBusy: boolean;
  isGenerating: boolean;
  supportsGenerate: boolean;
  onChangeText: (text: string) => void;
  onGenerate: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.inputContainer}>
      <AdaptiveTextInput
        testID="git-flyout-commit-input"
        accessibilityLabel={t("workspace.git.actions.commit.label", "提交信息")}
        initialValue={message}
        resetKey={resetKey}
        onChangeText={onChangeText}
        placeholder={t("workspace.git.rail.placeholder", "提交信息（留空将自动生成）...")}
        style={styles.input}
        multiline
        numberOfLines={3}
        editable={!isBusy}
      />
      {supportsGenerate ? (
        <Pressable
          onPress={onGenerate}
          disabled={isBusy}
          style={styles.generateButton}
          accessibilityRole="button"
          accessibilityLabel={t("workspace.git.actions.commit.sheet.generate", "自动生成")}
          testID="git-flyout-generate"
        >
          {isGenerating ? (
            <LoadingSpinner size={12} color={styles.generateText.color} />
          ) : (
            <ThemedSparkles size={12} uniProps={mutedColorMapping} />
          )}
          <Text style={styles.generateText}>
            {isGenerating
              ? t("workspace.git.rail.generating", "生成中...")
              : t("workspace.git.actions.commit.sheet.generate", "自动生成")}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function GitFlyoutCheckboxRow({
  includeUnstaged,
  onToggle,
  diffStat,
  isDirty,
}: {
  includeUnstaged: boolean;
  onToggle: () => void;
  diffStat?: { additions: number; deletions: number } | null;
  isDirty: boolean;
}) {
  const { t } = useTranslation();
  const accessibilityState = useMemo(() => ({ checked: includeUnstaged }), [includeUnstaged]);

  return (
    <Pressable
      style={styles.checkboxRow}
      onPress={onToggle}
      accessibilityRole="checkbox"
      accessibilityState={accessibilityState}
    >
      <View style={styles.checkboxLeft}>
        <View style={[styles.checkbox, includeUnstaged && styles.checkboxActive]}>
          {includeUnstaged ? <ThemedCheck size={12} uniProps={successColorMapping} /> : null}
        </View>
        <Text style={styles.checkboxLabel}>
          {t("workspace.git.rail.includeUnstagedChanges", "包含未暂存的更改")}
        </Text>
      </View>
      {diffStat && (diffStat.additions > 0 || diffStat.deletions > 0) ? (
        <DiffStat additions={diffStat.additions} deletions={diffStat.deletions} />
      ) : (
        <Text style={styles.cleanLabel}>
          {isDirty
            ? t("workspace.git.rail.dirty", "有变更")
            : t("workspace.git.rail.clean", "工作区干净")}
        </Text>
      )}
    </Pressable>
  );
}

function GitFlyoutActions({
  commitDisabled,
  pushDisabled,
  onCommit,
  onCommitAndPush,
  onPush,
}: {
  commitDisabled: boolean;
  pushDisabled: boolean;
  onCommit: () => void;
  onCommitAndPush: () => void;
  onPush: () => void;
}) {
  const { t } = useTranslation();

  const commitRowStyle = useCallback(
    ({ pressed, hovered }: { pressed?: boolean; hovered?: boolean }) => [
      styles.actionRow,
      hovered && styles.actionRowHovered,
      pressed && styles.actionRowPressed,
      commitDisabled && styles.actionRowDisabled,
    ],
    [commitDisabled],
  );

  const pushRowStyle = useCallback(
    ({ pressed, hovered }: { pressed?: boolean; hovered?: boolean }) => [
      styles.actionRow,
      hovered && styles.actionRowHovered,
      pressed && styles.actionRowPressed,
      pushDisabled && styles.actionRowDisabled,
    ],
    [pushDisabled],
  );

  return (
    <View style={styles.buttonList}>
      <Pressable
        onPress={onCommit}
        disabled={commitDisabled}
        style={commitRowStyle}
        testID="git-flyout-commit-button"
      >
        <View style={styles.actionRowLeft}>
          <ThemedGitCommit size={14} uniProps={accentColorMapping} />
          <Text style={styles.actionRowLabel}>
            {t("workspace.git.actions.commit.label", "提交")}
          </Text>
        </View>
        <View style={styles.shortcutBadge}>
          <Text style={styles.shortcutBadgeText}>⌘↩</Text>
        </View>
      </Pressable>

      <Pressable
        onPress={onCommitAndPush}
        disabled={commitDisabled}
        style={commitRowStyle}
        testID="git-flyout-commit-push-button"
      >
        <View style={styles.actionRowLeft}>
          <ThemedUploadCloud size={14} uniProps={mutedColorMapping} />
          <Text style={styles.actionRowLabel}>
            {t("workspace.git.rail.commitAndPush", "提交并推送")}
          </Text>
        </View>
      </Pressable>

      <Pressable
        onPress={onPush}
        disabled={pushDisabled}
        style={pushRowStyle}
        testID="git-flyout-push-button"
      >
        <View style={styles.actionRowLeft}>
          <ThemedArrowUpFromLine size={14} uniProps={mutedColorMapping} />
          <Text style={styles.actionRowLabel}>{t("workspace.git.actions.push.label", "推送")}</Text>
        </View>
      </Pressable>
    </View>
  );
}

export function GitFlyout({
  serverId,
  workspaceId,
  cwd,
  git,
  diffStat,
  isOpen,
  onClose,
  anchorRect,
}: GitFlyoutProps): ReactElement | null {
  const { t } = useTranslation();
  const toast = useToast();
  const windowDimensions = useWindowDimensions();
  const supportsGenerate = useHostFeature(serverId, "checkoutGitGenerateCommitMessage");
  const overlayLayer = useOverlayLayer("modal");

  const [message, setMessage] = useState("");
  const [resetKey, setResetKey] = useState(0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [includeUnstaged, setIncludeUnstaged] = useState(true);

  const handleClose = useCallback(() => {
    setErrorMessage("");
    onClose();
  }, [onClose]);

  const handleToggleIncludeUnstaged = useCallback(() => {
    setIncludeUnstaged((prev) => !prev);
  }, []);

  const handleGenerate = useCallback(async () => {
    if (isGenerating) return;
    setIsGenerating(true);
    setErrorMessage("");
    try {
      const generated = await useCheckoutGitActionsStore
        .getState()
        .generateCommitMessage({ serverId, cwd });
      setMessage(generated);
      setResetKey((key) => key + 1);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : t("workspace.git.actions.commit.generateFailed"),
      );
    } finally {
      setIsGenerating(false);
    }
  }, [cwd, isGenerating, serverId, t]);

  const runAction = useCallback(
    (action: "commit" | "commit-and-push" | "push") => {
      if (isGenerating) return;
      if (action !== "push" && !git.isDirty) return;
      if (action === "push" && !git.ahead) return;
      const trimmedMessage = message.trim();
      if (action !== "push" && !trimmedMessage && !supportsGenerate) {
        setErrorMessage(t("workspace.git.rail.emptyMessage", "请先输入提交信息"));
        return;
      }
      // Close first so the flyout backdrop stops blocking the rest of the app.
      // The store dedupes in-flight actions and invalidates queries on completion.
      setErrorMessage("");
      setMessage("");
      setResetKey((key) => key + 1);
      onClose();
      void (async () => {
        try {
          const store = useCheckoutGitActionsStore.getState();
          let finalMessage = trimmedMessage;
          if (action !== "push" && !finalMessage) {
            finalMessage = await store.generateCommitMessage({ serverId, cwd });
          }
          if (action !== "push") {
            await store.commit({ serverId, cwd, message: finalMessage });
          }
          if (action !== "commit") {
            await store.push({ serverId, cwd });
          }
          toast.show(
            action === "commit"
              ? t("workspace.git.actions.commit.success", "提交成功")
              : t("workspace.git.actions.push.success", "推送成功"),
            { variant: "success" },
          );
        } catch (error) {
          toast.error(
            error instanceof Error
              ? error.message
              : t("workspace.git.actions.toasts.failedCommit", "操作失败"),
          );
        }
      })();
    },
    [
      cwd,
      git.ahead,
      git.isDirty,
      isGenerating,
      message,
      onClose,
      serverId,
      supportsGenerate,
      t,
      toast,
    ],
  );

  const handleCommit = useCallback(() => runAction("commit"), [runAction]);
  const handleCommitAndPush = useCallback(() => runAction("commit-and-push"), [runAction]);
  const handlePush = useCallback(() => runAction("push"), [runAction]);

  const runActionRef = useRef(runAction);
  runActionRef.current = runAction;

  useEffect(() => {
    if (!isOpen || !isWeb) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        runActionRef.current("commit");
      } else if (event.key === "Escape") {
        event.preventDefault();
        handleClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleClose, isOpen]);

  const flyoutPosition = useMemo(() => {
    const maxRight = Math.max(16, windowDimensions.width - FLYOUT_WIDTH - 16);
    if (!anchorRect || typeof anchorRect.x !== "number" || isNaN(anchorRect.x)) {
      return {
        top: 80,
        right: Math.min(300, maxRight),
      };
    }
    const calculatedRight = windowDimensions.width - anchorRect.x + 8;
    const right = Math.min(maxRight, Math.max(16, calculatedRight));

    const maxTop = Math.max(16, windowDimensions.height - FLYOUT_ESTIMATED_HEIGHT - 16);
    let top = anchorRect.y - 12;
    if (top > maxTop) {
      top = maxTop;
    }
    return {
      top: Math.max(16, top),
      right,
    };
  }, [anchorRect, windowDimensions.height, windowDimensions.width]);

  const containerStyle = useMemo(
    () => [
      styles.container,
      {
        top: flyoutPosition.top,
        right: flyoutPosition.right,
        width: Math.min(FLYOUT_WIDTH, windowDimensions.width - 32),
        maxHeight: Math.max(200, windowDimensions.height - 32),
      },
    ],
    [flyoutPosition.right, flyoutPosition.top, windowDimensions.height, windowDimensions.width],
  );

  if (!isOpen) return null;

  const branchName = git.branch ?? t("workspace.git.rail.detached", "游离 HEAD");
  const commitDisabled = isGenerating || !git.isDirty;
  const pushDisabled = isGenerating || !git.ahead;

  const content = (
    <OverlayLayerProvider layer={overlayLayer}>
      <View
        style={[styles.backdropOverlay, isWeb ? { zIndex: overlayLayer } : null]}
        pointerEvents="box-none"
      >
        <Pressable
          style={styles.backdrop}
          onPress={handleClose}
          accessibilityLabel={t("common.close", "关闭")}
        />
        <FloatingSurface style={containerStyle} testID="git-flyout">
          <ScrollView
            bounces={false}
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <GitFlyoutBranchHeader
              branchName={branchName}
              serverId={serverId}
              workspaceId={workspaceId}
              cwd={cwd}
            />

            <GitFlyoutInput
              message={message}
              resetKey={resetKey}
              isBusy={isGenerating}
              isGenerating={isGenerating}
              supportsGenerate={supportsGenerate}
              onChangeText={setMessage}
              onGenerate={handleGenerate}
            />

            <GitFlyoutCheckboxRow
              includeUnstaged={includeUnstaged}
              onToggle={handleToggleIncludeUnstaged}
              diffStat={diffStat}
              isDirty={git.isDirty}
            />

            {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}

            <GitFlyoutActions
              commitDisabled={commitDisabled}
              pushDisabled={pushDisabled}
              onCommit={handleCommit}
              onCommitAndPush={handleCommitAndPush}
              onPush={handlePush}
            />
          </ScrollView>
        </FloatingSurface>
      </View>
    </OverlayLayerProvider>
  );

  if (isWeb) {
    return createPortal(content, getOverlayRoot());
  }

  return <Portal>{content}</Portal>;
}

const styles = StyleSheet.create((theme) => ({
  backdropOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  container: {
    position: "absolute",
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius.xl,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    padding: theme.spacing[3],
    ...theme.shadow.lg,
  },
  scroll: {
    flexShrink: 1,
  },
  scrollContent: {
    gap: theme.spacing[2],
  },
  branchSwitcherAnchor: {
    width: "100%",
  },
  branchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[1.5],
    borderRadius: theme.borderRadius.md,
  },
  branchRowHovered: {
    backgroundColor: theme.colors.surface2,
  },
  branchRowPressed: {
    backgroundColor: theme.colors.surface3,
  },
  branchRowLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flex: 1,
    minWidth: 0,
  },
  branchText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    flexShrink: 1,
  },
  inputContainer: {
    position: "relative",
  },
  input: {
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    minHeight: 72,
  },
  generateButton: {
    position: "absolute",
    bottom: theme.spacing[2],
    right: theme.spacing[2],
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    backgroundColor: theme.colors.surface1,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 2,
    borderRadius: theme.borderRadius.full,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  generateText: {
    fontSize: 11,
    color: theme.colors.foregroundMuted,
  },
  checkboxRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[1],
  },
  checkboxLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  checkbox: {
    width: 16,
    height: 16,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  checkboxActive: {
    borderColor: theme.colors.statusSuccess,
  },
  checkboxLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  cleanLabel: {
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.sm,
  },
  errorText: {
    color: theme.colors.statusDanger,
    fontSize: 11,
    paddingHorizontal: theme.spacing[1],
  },
  buttonList: {
    gap: theme.spacing[1],
    paddingTop: theme.spacing[1],
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
  },
  actionRowHovered: {
    backgroundColor: theme.colors.surface2,
  },
  actionRowPressed: {
    backgroundColor: theme.colors.surface3,
  },
  actionRowDisabled: {
    opacity: 0.4,
  },
  actionRowLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  actionRowLabel: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  shortcutBadge: {
    backgroundColor: theme.colors.surface2,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  shortcutBadgeText: {
    color: theme.colors.foregroundMuted,
    fontSize: 11,
    fontFamily: theme.fontFamily.mono,
  },
}));
