import { useCallback, useMemo, useRef, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ChevronDown, FileDiff, GitBranch, GitCommit, Monitor } from "lucide-react-native";
import { DiffStat } from "@/components/diff-stat";
import { Section } from "@/components/ui/section";
import { useVisibleWorkspaceDiffStat } from "@/composer/workspace-diff-stat";
import { getForgeIconComponent } from "@/git/forge-icon";
import { useWorkspacePrHint } from "@/git/use-pr-status-query";
import { useHosts } from "@/runtime/host-runtime";
import { type Theme } from "@/styles/theme";
import { openExternalUrl } from "@/utils/open-external-url";
import { type RailGitState } from "@/workspace-rail/rail-state";
import { BranchSwitcher } from "@/components/branch-switcher";
import { GitFlyout, type GitFlyoutAnchorRect } from "./git-flyout";

const ThemedGitBranch = withUnistyles(GitBranch);
const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedFileDiff = withUnistyles(FileDiff);
const ThemedMonitor = withUnistyles(Monitor);
const ThemedGitCommit = withUnistyles(GitCommit);

const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

export function EnvironmentSection({
  serverId,
  cwd,
  workspaceId,
  git,
  divided,
  open,
  onToggle,
  onOpenChanges,
}: {
  serverId: string;
  cwd: string;
  workspaceId: string;
  /** Owned by the rail, which needs it to decide whether this section exists at all. */
  git: RailGitState;
  divided: boolean;
  open: boolean;
  onToggle: () => void;
  onOpenChanges?: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const hosts = useHosts();
  const host = hosts.find((h) => h.serverId === serverId);
  const isLocalHost =
    !host ||
    host.serverId === "local" ||
    (typeof host.label === "string" &&
      (host.label.includes(".local") || host.label.toLowerCase() === "localhost"));
  const hostLabel = isLocalHost
    ? t("workspace.git.rail.localHost", "本地")
    : host?.label?.trim() || "本地";

  const diffStat = useVisibleWorkspaceDiffStat(serverId, workspaceId);
  const prHint = useWorkspacePrHint({ serverId, cwd, enabled: true });

  const commitTriggerRef = useRef<View>(null);
  const [anchorRect, setAnchorRect] = useState<GitFlyoutAnchorRect | null>(null);
  const [isFlyoutOpen, setIsFlyoutOpen] = useState(false);

  const handleOpenFlyout = useCallback(() => {
    if (commitTriggerRef.current) {
      commitTriggerRef.current.measureInWindow((x, y, width, height) => {
        if (typeof x === "number" && !isNaN(x) && typeof y === "number" && !isNaN(y)) {
          setAnchorRect({ x, y, width, height });
        }
        setIsFlyoutOpen(true);
      });
    } else {
      setIsFlyoutOpen(true);
    }
  }, []);

  const handleCloseFlyout = useCallback(() => {
    setIsFlyoutOpen(false);
  }, []);

  const handleOpenPullRequest = useCallback(() => {
    if (prHint) void openExternalUrl(prHint.url);
  }, [prHint]);

  const ForgeIcon = useMemo(
    () => withUnistyles(getForgeIconComponent(prHint?.forge ?? "github")),
    [prHint?.forge],
  );

  const actionRowStyle = useCallback(
    ({ pressed, hovered }: { pressed?: boolean; hovered?: boolean }) => [
      styles.actionRow,
      hovered && styles.actionRowHovered,
      pressed && styles.actionRowPressed,
    ],
    [],
  );

  const renderBranchTrigger = useCallback(
    ({ onPress, label, testID }: { onPress: () => void; label: string; testID?: string }) => (
      <Pressable
        onPress={onPress}
        style={actionRowStyle}
        accessibilityRole="button"
        accessibilityLabel={t("branchSwitcher.currentBranch", { branchName: label })}
        testID={testID}
      >
        <View style={styles.rowLeft}>
          <ThemedGitBranch size={14} uniProps={mutedColorMapping} />
          <Text style={styles.rowLabel} numberOfLines={1}>
            {label}
          </Text>
        </View>
        <ThemedChevronDown size={14} uniProps={mutedColorMapping} />
      </Pressable>
    ),
    [actionRowStyle, t],
  );

  return (
    <>
      <Section
        title={t("workspace.git.rail.environmentInfo", "环境信息")}
        open={open}
        onToggle={onToggle}
        variant="rail"
        divided={divided}
      >
        <View style={styles.body}>
          {/* Row 1: 变更 */}
          <Pressable
            onPress={onOpenChanges}
            disabled={!onOpenChanges}
            style={actionRowStyle}
            accessibilityRole="button"
            accessibilityLabel={t("workspace.git.rail.changes", "变更")}
          >
            <View style={styles.rowLeft}>
              <ThemedFileDiff size={14} uniProps={mutedColorMapping} />
              <Text style={styles.rowLabel}>{t("workspace.git.rail.changes", "变更")}</Text>
            </View>
            <View style={styles.rowRightGroup}>
              <DiffStat
                additions={diffStat?.additions ?? 0}
                deletions={diffStat?.deletions ?? 0}
                testID="workspace-rail-diff-stat"
              />
            </View>
          </Pressable>

          {/* Row 2: 本地 */}
          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <ThemedMonitor size={14} uniProps={mutedColorMapping} />
              <Text style={styles.rowLabel}>{hostLabel}</Text>
            </View>
          </View>

          {/* Row 3: 分支 */}
          <BranchSwitcher
            currentBranchName={git.branch}
            serverId={serverId}
            workspaceId={workspaceId}
            workspaceDirectory={cwd}
            isGitCheckout
            testID="workspace-rail-branch-switcher"
            desktopPlacement="bottom-start"
            containerStyle={styles.branchContainer}
            renderTrigger={renderBranchTrigger}
          />

          {/* Row 4: 提交或推送 */}
          <View ref={commitTriggerRef} collapsable={false}>
            <Pressable
              onPress={handleOpenFlyout}
              style={actionRowStyle}
              accessibilityRole="button"
              accessibilityLabel={t("workspace.git.rail.commitOrPush", "提交或推送")}
              testID="workspace-rail-commit"
            >
              <View style={styles.rowLeft}>
                <ThemedGitCommit size={14} uniProps={mutedColorMapping} />
                <Text style={styles.actionLabel}>
                  {t("workspace.git.rail.commitOrPush", "提交或推送")}
                </Text>
              </View>
            </Pressable>
          </View>

          {/* Row 5: PR 状态 */}
          {prHint ? (
            <Pressable
              onPress={handleOpenPullRequest}
              style={actionRowStyle}
              accessibilityRole="button"
              accessibilityLabel={t("workspace.git.rail.openPr", "打开拉取请求")}
              testID="workspace-rail-pr"
            >
              <View style={styles.rowLeft}>
                <ForgeIcon size={14} uniProps={mutedColorMapping} />
                <Text style={styles.actionLabel} numberOfLines={1}>
                  {`#${prHint.number} · ${t(`workspace.pr.states.${prHint.state}`)}`}
                </Text>
              </View>
            </Pressable>
          ) : (
            <View style={styles.row}>
              <View style={styles.rowLeft}>
                <ForgeIcon size={14} uniProps={mutedColorMapping} />
                <Text style={styles.cleanLabel} numberOfLines={1}>
                  {t("workspace.git.rail.prUnavailable", "无法获取拉取请求状态")}
                </Text>
              </View>
            </View>
          )}
        </View>
      </Section>

      <GitFlyout
        serverId={serverId}
        workspaceId={workspaceId}
        cwd={cwd}
        git={git}
        diffStat={diffStat}
        isOpen={isFlyoutOpen}
        onClose={handleCloseFlyout}
        anchorRect={anchorRect}
      />
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  body: {
    paddingHorizontal: theme.spacing[4],
    gap: theme.spacing[1.5],
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: theme.spacing[1.5],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    minHeight: 28,
  },
  rowLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flex: 1,
    minWidth: 0,
  },
  rowRightGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
  },
  rowLabel: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    flexShrink: 1,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: theme.spacing[1.5],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    minHeight: 28,
  },
  actionRowHovered: {
    backgroundColor: theme.colors.surface2,
  },
  actionRowPressed: {
    backgroundColor: theme.colors.surface3,
  },
  actionLabel: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  cleanLabel: {
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.sm,
  },
  branchContainer: {
    width: "100%",
  },
}));
