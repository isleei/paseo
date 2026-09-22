import { ArrowUpToLine, RefreshCw } from "lucide-react-native";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { AgentProvider } from "@getpaseo/protocol/agent-types";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { EnvironmentList } from "./list";
import type { EnvironmentUpgradeEntry, EnvironmentView } from "./types";

export function EnvironmentSettingsSection({
  serverId,
  view,
  upgradingProvider,
  upgradingAll,
  upgradableCount,
  lastResults,
  onRefresh,
  onUpgrade,
  onUpgradeAll,
}: {
  serverId: string;
  view: EnvironmentView;
  upgradingProvider: AgentProvider | null;
  upgradingAll: boolean;
  upgradableCount: number;
  lastResults: Partial<Record<AgentProvider, EnvironmentUpgradeEntry>>;
  onRefresh: () => void;
  onUpgrade: (provider: AgentProvider) => void;
  onUpgradeAll: () => void;
}) {
  const { t } = useTranslation();
  const busy = view.kind === "loading" || (view.kind === "ready" && view.isFetching);

  const trailing = useMemo(
    () => (
      <View style={styles.trailing}>
        <Button
          variant="outline"
          size="sm"
          leftIcon={ArrowUpToLine}
          loading={upgradingAll}
          disabled={upgradableCount === 0 || busy}
          onPress={onUpgradeAll}
          accessibilityLabel={t("settings.environment.upgradeAll")}
        >
          {upgradingAll
            ? t("settings.environment.upgrading")
            : t("settings.environment.upgradeAll")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          leftIcon={RefreshCw}
          loading={busy}
          onPress={onRefresh}
          accessibilityLabel={t("settings.environment.refresh")}
        >
          {busy ? t("settings.environment.refreshing") : t("settings.environment.refresh")}
        </Button>
      </View>
    ),
    [busy, onRefresh, onUpgradeAll, t, upgradableCount, upgradingAll],
  );

  return (
    <SettingsSection
      title={t("settings.environment.title")}
      testID="environment-card"
      trailing={trailing}
    >
      <EnvironmentBody
        serverId={serverId}
        view={view}
        upgradingProvider={upgradingProvider}
        lastResults={lastResults}
        onRefresh={onRefresh}
        onUpgrade={onUpgrade}
      />
    </SettingsSection>
  );
}

function EnvironmentBody({
  serverId,
  view,
  upgradingProvider,
  lastResults,
  onRefresh,
  onUpgrade,
}: {
  serverId: string;
  view: EnvironmentView;
  upgradingProvider: AgentProvider | null;
  lastResults: Partial<Record<AgentProvider, EnvironmentUpgradeEntry>>;
  onRefresh: () => void;
  onUpgrade: (provider: AgentProvider) => void;
}) {
  const { t } = useTranslation();

  if (view.kind === "loading") {
    return (
      <View style={[settingsStyles.card, styles.emptyCard]}>
        <Text style={styles.emptyText}>{t("settings.environment.loading")}</Text>
      </View>
    );
  }

  if (view.kind === "error") {
    return (
      <Alert
        variant="error"
        title={t("settings.environment.errorTitle")}
        description={view.message}
      >
        <Button variant="outline" size="sm" onPress={onRefresh}>
          {t("settings.environment.retry")}
        </Button>
      </Alert>
    );
  }

  if (view.payload.providers.length === 0) {
    return (
      <View style={[settingsStyles.card, styles.emptyCard]}>
        <Text style={styles.emptyText}>{t("settings.environment.empty")}</Text>
      </View>
    );
  }

  return (
    <EnvironmentList
      serverId={serverId}
      providers={view.payload.providers}
      upgradingProvider={upgradingProvider}
      lastResults={lastResults}
      onUpgrade={onUpgrade}
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  trailing: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  emptyCard: {
    padding: theme.spacing[4],
    alignItems: "center",
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
}));
