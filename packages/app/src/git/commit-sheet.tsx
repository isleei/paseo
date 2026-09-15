import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import {
  AdaptiveModalSheet,
  AdaptiveTextInput,
  type SheetHeader,
} from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { useHostFeature } from "@/runtime/host-features";
import { useToast } from "@/contexts/toast-context";
import { useCheckoutGitActionsStore } from "@/git/actions-store";
import { useCommitSheetStore } from "@/git/commit-sheet-store";

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
      key={`${request.serverId}::${request.cwd}`}
      serverId={request.serverId}
      cwd={request.cwd}
      onClose={closeCommitSheet}
    />
  );
}

function CommitSheet({
  serverId,
  cwd,
  onClose,
}: {
  serverId: string;
  cwd: string;
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

  const isBusy = isGenerating || isCommitting;
  const header = useMemo<SheetHeader>(
    () => ({ title: t("workspace.git.actions.commit.sheet.title") }),
    [t],
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

  const handleCommit = useCallback(async () => {
    if (isBusy) return;
    setIsCommitting(true);
    setErrorMessage("");
    try {
      const trimmed = message.trim();
      await useCheckoutGitActionsStore.getState().commit({
        serverId,
        cwd,
        message: trimmed.length > 0 ? trimmed : undefined,
      });
      toast.show(t("workspace.git.actions.commit.success"), { variant: "success" });
      onClose();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : t("workspace.git.actions.toasts.failedCommit"),
      );
    } finally {
      setIsCommitting(false);
    }
  }, [cwd, isBusy, message, onClose, serverId, t, toast]);

  useEffect(() => {
    setMessage("");
    setErrorMessage("");
  }, [serverId, cwd]);

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
          editable={!isCommitting}
          autoFocus
        />
        <Text style={styles.hint}>{t("workspace.git.actions.commit.sheet.hint")}</Text>
        {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
      </View>

      <View style={styles.actions}>
        {supportsGenerate ? (
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
          onPress={handleCommit}
          disabled={isBusy}
          testID="commit-sheet-submit"
        >
          {isCommitting
            ? t("workspace.git.actions.commit.pending")
            : t("workspace.git.actions.commit.sheet.submit")}
        </Button>
      </View>
    </AdaptiveModalSheet>
  );
}
