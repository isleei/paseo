import { useCallback, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ArrowUpRight, GitBranch, Sparkles } from "lucide-react-native";
import { AdaptiveTextInput } from "@/components/adaptive-text-input";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Section } from "@/components/ui/section";
import { useToast } from "@/contexts/toast-context";
import { useVisibleWorkspaceDiffStat } from "@/composer/workspace-diff-stat";
import { useCheckoutGitActionsStore } from "@/git/actions-store";
import { useWorkspacePrHint } from "@/git/use-pr-status-query";
import { useHostFeature } from "@/runtime/host-features";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { openExternalUrl } from "@/utils/open-external-url";
import {
  formatDiffStat,
  formatUpstreamDelta,
  type RailGitState,
} from "@/workspace-rail/rail-state";

const ThemedGitBranch = withUnistyles(GitBranch);
const ThemedSparkles = withUnistyles(Sparkles);
const ThemedArrowUpRight = withUnistyles(ArrowUpRight);

const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/** The secondary button names the next useful thing, so the tree's state picks the verb. */
type SecondaryAction = "commit-and-push" | "push" | "none";

function resolveSecondaryAction(git: RailGitState): SecondaryAction {
  if (!git.hasRemote) {
    return "none";
  }
  if (git.isDirty) {
    return "commit-and-push";
  }
  return git.ahead ? "push" : "none";
}

export function EnvironmentSection({
  serverId,
  cwd,
  workspaceId,
  git,
  divided,
  open,
  onToggle,
}: {
  serverId: string;
  cwd: string;
  workspaceId: string;
  /** Owned by the rail, which needs it to decide whether this section exists at all. */
  git: RailGitState;
  divided: boolean;
  open: boolean;
  onToggle: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const toast = useToast();
  const diffStat = useVisibleWorkspaceDiffStat(serverId, workspaceId);
  const prHint = useWorkspacePrHint({ serverId, cwd, enabled: true });
  const supportsGenerate = useHostFeature(serverId, "checkoutGitGenerateCommitMessage");

  const [message, setMessage] = useState("");
  const [resetKey, setResetKey] = useState(0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [busyAction, setBusyAction] = useState<SecondaryAction | "commit" | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  const isBusy = isGenerating || busyAction !== null;

  const handleGenerate = useCallback(async () => {
    if (isBusy) return;
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
  }, [cwd, isBusy, serverId, t]);

  const runAction = useCallback(
    async (action: "commit" | "commit-and-push" | "push") => {
      if (isBusy) return;
      setBusyAction(action);
      setErrorMessage("");
      try {
        const store = useCheckoutGitActionsStore.getState();
        if (action !== "push") {
          let finalMessage = message.trim();
          if (!finalMessage) {
            if (!supportsGenerate) {
              setErrorMessage(t("workspace.git.rail.emptyMessage"));
              return;
            }
            setIsGenerating(true);
            try {
              finalMessage = await store.generateCommitMessage({ serverId, cwd });
              setMessage(finalMessage);
              setResetKey((key) => key + 1);
            } finally {
              setIsGenerating(false);
            }
          }
          await store.commit({ serverId, cwd, message: finalMessage });
          setMessage("");
          setResetKey((key) => key + 1);
        }
        if (action !== "commit") {
          await store.push({ serverId, cwd });
        }
        toast.show(
          action === "commit"
            ? t("workspace.git.actions.commit.success")
            : t("workspace.git.actions.push.success"),
          { variant: "success" },
        );
      } catch (error) {
        setErrorMessage(
          error instanceof Error ? error.message : t("workspace.git.actions.toasts.failedCommit"),
        );
      } finally {
        setBusyAction(null);
      }
    },
    [cwd, isBusy, message, serverId, supportsGenerate, t, toast],
  );

  const handleCommit = useCallback(() => void runAction("commit"), [runAction]);
  const handleCommitAndPush = useCallback(() => void runAction("commit-and-push"), [runAction]);
  const handlePush = useCallback(() => void runAction("push"), [runAction]);
  const handleOpenPullRequest = useCallback(() => {
    if (prHint) void openExternalUrl(prHint.url);
  }, [prHint]);

  const summary = useMemo(() => {
    const delta = formatUpstreamDelta(git);
    return (
      <View style={styles.summaryGroup}>
        <ThemedGitBranch size={ICON_SIZE.sm} uniProps={mutedColorMapping} />
        <Text style={styles.summaryText} numberOfLines={1}>
          {git.branch ?? t("workspace.git.rail.detached")}
        </Text>
        {delta ? <Text style={styles.summaryText}>{delta}</Text> : null}
      </View>
    );
  }, [git, t]);

  const diffLabel = formatDiffStat(diffStat);
  const secondary = resolveSecondaryAction(git);
  const commitDisabled = isBusy || !git.isDirty;
  const pushDisabled = isBusy || !git.ahead;

  return (
    <Section
      title={t("workspace.git.rail.environment")}
      open={open}
      onToggle={onToggle}
      summary={summary}
      variant="rail"
      divided={divided}
    >
      <View style={styles.body}>
        <Text style={styles.changeLine} numberOfLines={1}>
          {diffLabel ??
            (git.isDirty ? t("workspace.git.rail.dirty") : t("workspace.git.rail.clean"))}
        </Text>

        {prHint ? (
          <Pressable
            onPress={handleOpenPullRequest}
            style={styles.prRow}
            accessibilityRole="link"
            accessibilityLabel={t("workspace.git.rail.openPullRequest", { number: prHint.number })}
            testID="workspace-rail-pr"
          >
            <Text style={styles.prText} numberOfLines={1}>
              #{prHint.number} · {t(`workspace.pr.states.${prHint.state}`)}
            </Text>
            <ThemedArrowUpRight size={12} uniProps={mutedColorMapping} />
          </Pressable>
        ) : null}

        <AdaptiveTextInput
          testID="workspace-rail-commit-input"
          accessibilityLabel={t("workspace.git.actions.commit.label")}
          initialValue={message}
          resetKey={resetKey}
          onChangeText={setMessage}
          placeholder={t("workspace.git.rail.placeholder")}
          style={styles.input}
          multiline
          numberOfLines={3}
          editable={!isBusy}
        />

        {supportsGenerate ? (
          <Pressable
            onPress={handleGenerate}
            disabled={isBusy}
            style={styles.generateRow}
            accessibilityRole="button"
            accessibilityLabel={t("workspace.git.actions.commit.sheet.generate")}
            testID="workspace-rail-generate"
          >
            {isGenerating ? (
              <LoadingSpinner size={14} color={styles.generateText.color} />
            ) : (
              <ThemedSparkles size={14} uniProps={mutedColorMapping} />
            )}
            <Text style={styles.generateText}>
              {isGenerating
                ? t("workspace.git.rail.generating")
                : t("workspace.git.actions.commit.sheet.generate")}
            </Text>
          </Pressable>
        ) : null}

        {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}

        <View style={styles.actions}>
          <Button
            style={styles.actionFlex}
            size="sm"
            variant="default"
            onPress={handleCommit}
            disabled={commitDisabled}
            testID="workspace-rail-commit"
          >
            {busyAction === "commit"
              ? t("workspace.git.actions.commit.pending")
              : t("workspace.git.actions.commit.label")}
          </Button>
          {secondary === "commit-and-push" ? (
            <Button
              style={styles.actionFlex}
              size="sm"
              variant="secondary"
              onPress={handleCommitAndPush}
              disabled={commitDisabled}
              testID="workspace-rail-commit-push"
            >
              {busyAction === "commit-and-push"
                ? t("workspace.git.rail.commitPushing")
                : t("workspace.git.rail.commitAndPush")}
            </Button>
          ) : null}
          {secondary === "push" ? (
            <Button
              style={styles.actionFlex}
              size="sm"
              variant="secondary"
              onPress={handlePush}
              disabled={pushDisabled}
              testID="workspace-rail-push"
            >
              {busyAction === "push"
                ? t("workspace.git.rail.pushing")
                : t("workspace.git.actions.push.label")}
            </Button>
          ) : null}
        </View>
      </View>
    </Section>
  );
}

const styles = StyleSheet.create((theme) => ({
  summaryGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flexShrink: 1,
  },
  summaryText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    flexShrink: 1,
  },
  summaryDelta: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  body: {
    paddingHorizontal: theme.spacing[4],
    gap: theme.spacing[2],
  },
  changeLine: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  prRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  prText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    flexShrink: 1,
  },
  input: {
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    minHeight: 64,
  },
  generateRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  generateText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  error: {
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.sm,
  },
  actions: {
    flexDirection: "row",
    gap: theme.spacing[2],
  },
  actionFlex: {
    flex: 1,
  },
}));
