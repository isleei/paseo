import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { AlertTriangle } from "lucide-react-native";
import {
  AdaptiveModalSheet,
  AdaptiveTextInput,
  type SheetHeader,
} from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { useHostFeature } from "@/runtime/host-features";
import { useToast } from "@/contexts/toast-context";
import { CommitFollowUpError, useCheckoutGitActionsStore } from "@/git/actions-store";
import { useCommitSheetStore } from "@/git/commit-sheet-store";
import { copyToClipboard } from "@/utils/copy-to-clipboard";
import { isPreCommitHookError } from "./commit-hook-error";
import type { Theme } from "@/styles/theme";

const ThemedAlertTriangle = withUnistyles(AlertTriangle);
const warningIconMapping = (theme: Theme) => ({ color: theme.colors.palette.amber[500] });

const styles = StyleSheet.create((theme) => ({
  field: {
    gap: theme.spacing[2],
  },
  label: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  input: {
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.lg,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    color: theme.colors.foreground,
    fontSize: theme.fontSize.content,
    borderWidth: 1,
    borderColor: theme.colors.border,
    minHeight: 96,
  },
  hint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  error: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.base,
  },
  hookFailureCard: {
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.palette.amber[500],
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing[3],
    gap: theme.spacing[2],
  },
  hookFailureHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  hookFailureTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
  },
  hookErrorScroll: {
    maxHeight: 110,
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius.sm,
    padding: theme.spacing[2],
  },
  hookErrorText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.code,
    fontFamily: theme.fontFamily.mono,
  },
  hookActions: {
    flexDirection: "row",
    gap: theme.spacing[2],
    marginTop: theme.spacing[1],
  },
  actions: {
    flexDirection: "row",
    gap: theme.spacing[3],
    marginTop: theme.spacing[2],
  },
  actionFlex: {
    flex: 1,
  },
}));

export function CommitSheetHost() {
  const request = useCommitSheetStore((s) => s.request);
  const closeCommitSheet = useCommitSheetStore((s) => s.closeCommitSheet);
  if (!request) return null;
  return (
    <CommitSheet
      key={`${request.serverId}::${request.cwd}::${request.action ?? "commit"}`}
      serverId={request.serverId}
      cwd={request.cwd}
      action={request.action ?? "commit"}
      onClose={closeCommitSheet}
    />
  );
}

function CommitSheet({
  serverId,
  cwd,
  action,
  onClose,
}: {
  serverId: string;
  cwd: string;
  action: "commit" | "commit-and-push" | "commit-and-create-pr";
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const supportsGenerate = useHostFeature(serverId, "checkoutGitGenerateCommitMessage");
  const [message, setMessage] = useState("");
  const [resetKey, setResetKey] = useState(0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [followUp, setFollowUp] = useState<"push" | "create-pr" | null>(null);
  const actionKeys = {
    commit: "workspace.git.actions.commit",
    "commit-and-push": "workspace.git.actions.commitAndPush",
    "commit-and-create-pr": "workspace.git.actions.commitAndCreatePr",
  } as const;
  const actionKey = actionKeys[action];

  const isBusy = isGenerating || isCommitting;
  const header = useMemo<SheetHeader>(
    () => ({
      title: t(
        action === "commit" ? "workspace.git.actions.commit.sheet.title" : `${actionKey}.label`,
      ),
    }),
    [action, actionKey, t],
  );

  const handleClose = useCallback(() => {
    if (isBusy) return;
    setErrorMessage("");
    onClose();
  }, [isBusy, onClose]);

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

  const handleCommit = useCallback(
    async (options?: { noVerify?: boolean }) => {
      if (isBusy) return;
      setIsCommitting(true);
      setErrorMessage("");
      try {
        const trimmed = message.trim();
        const store = useCheckoutGitActionsStore.getState();
        const commitInput = {
          serverId,
          cwd,
          message: trimmed.length > 0 ? trimmed : undefined,
          noVerify: options?.noVerify,
        };
        if (followUp === "push") await store.push({ serverId, cwd });
        else if (followUp === "create-pr") await store.createPr({ serverId, cwd });
        else if (action === "commit-and-push") await store.commitAndPush(commitInput);
        else if (action === "commit-and-create-pr") await store.commitAndCreatePr(commitInput);
        else await store.commit(commitInput);
        toast.show(t(`${actionKey}.success`), { variant: "success" });
        onClose();
      } catch (error) {
        if (error instanceof CommitFollowUpError) setFollowUp(error.action);
        setErrorMessage(
          error instanceof Error ? error.message : t("workspace.git.actions.toasts.failedCommit"),
        );
      } finally {
        setIsCommitting(false);
      }
    },
    [action, actionKey, cwd, followUp, isBusy, message, onClose, serverId, t, toast],
  );

  const handleBypassHook = useCallback(async () => {
    await handleCommit({ noVerify: true });
  }, [handleCommit]);

  const handleAskAgentToFix = useCallback(async () => {
    const prompt = t("workspace.git.actions.commit.sheet.askAgentToFixPrompt", {
      error: errorMessage,
    });
    await copyToClipboard(prompt);
    toast.show(t("workspace.git.actions.commit.sheet.askAgentToFixCopied"), { variant: "success" });
    onClose();
  }, [errorMessage, onClose, t, toast]);

  const isHookError = followUp === null && isPreCommitHookError(errorMessage);

  const handleNormalCommit = useCallback(() => {
    void handleCommit();
  }, [handleCommit]);

  const errorView = useMemo(() => {
    if (!errorMessage) return null;
    if (isHookError) {
      return (
        <View style={styles.hookFailureCard} testID="commit-sheet-hook-failure">
          <View style={styles.hookFailureHeader}>
            <ThemedAlertTriangle size={16} uniProps={warningIconMapping} />
            <Text style={styles.hookFailureTitle}>
              {t("workspace.git.actions.commit.sheet.hookFailedBanner")}
            </Text>
          </View>
          <ScrollView style={styles.hookErrorScroll} nestedScrollEnabled>
            <Text style={styles.hookErrorText}>{errorMessage}</Text>
          </ScrollView>
          <View style={styles.hookActions}>
            <Button
              style={styles.actionFlex}
              variant="secondary"
              size="sm"
              onPress={handleAskAgentToFix}
              disabled={isBusy}
              testID="commit-sheet-ask-agent"
            >
              {t("workspace.git.actions.commit.sheet.askAgentToFix")}
            </Button>
            <Button
              style={styles.actionFlex}
              variant="destructive"
              size="sm"
              onPress={handleBypassHook}
              disabled={isBusy}
              testID="commit-sheet-bypass-hook"
            >
              {t("workspace.git.actions.commit.sheet.bypassHook")}
            </Button>
          </View>
        </View>
      );
    }
    return <Text style={styles.error}>{errorMessage}</Text>;
  }, [errorMessage, handleAskAgentToFix, handleBypassHook, isBusy, isHookError, t]);

  useEffect(() => {
    setMessage("");
    setErrorMessage("");
  }, [serverId, cwd]);

  let idleSubmitKey = `${actionKey}.label`;
  if (action === "commit") idleSubmitKey = "workspace.git.actions.commit.sheet.submit";
  if (followUp !== null) idleSubmitKey = "common.actions.retry";
  const submitLabel = t(isCommitting ? `${actionKey}.pending` : idleSubmitKey);

  return (
    <AdaptiveModalSheet header={header} visible onClose={handleClose} testID="commit-sheet">
      <View style={styles.field}>
        <Text style={styles.label}>{t("workspace.git.actions.commit.sheet.label")}</Text>
        <AdaptiveTextInput
          testID="commit-sheet-input"
          accessibilityLabel={t("workspace.git.actions.commit.sheet.label")}
          initialValue={message}
          resetKey={resetKey}
          onChangeText={setMessage}
          placeholder={t("workspace.git.actions.commit.sheet.placeholder")}
          style={styles.input}
          multiline
          numberOfLines={4}
          editable={!isCommitting && followUp === null}
          autoFocus
        />
        <Text style={styles.hint}>{t("workspace.git.actions.commit.sheet.hint")}</Text>
        {errorView}
      </View>

      <View style={styles.actions}>
        {supportsGenerate && followUp === null ? (
          <Button
            style={styles.actionFlex}
            variant="secondary"
            onPress={handleGenerate}
            disabled={isBusy}
            testID="commit-sheet-generate"
          >
            {isGenerating
              ? t("workspace.git.actions.commit.sheet.generating")
              : t("workspace.git.actions.commit.sheet.generate")}
          </Button>
        ) : null}
        <Button
          style={styles.actionFlex}
          variant="default"
          onPress={handleNormalCommit}
          disabled={isBusy}
          testID="commit-sheet-submit"
        >
          {submitLabel}
        </Button>
      </View>
    </AdaptiveModalSheet>
  );
}
