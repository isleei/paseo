import { Fragment, useCallback } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { AgentProvider } from "@getpaseo/protocol/agent-types";
import { settingsStyles } from "@/styles/settings";
import { EnvironmentCard } from "./card";
import type { EnvironmentCheckEntry, EnvironmentUpgradeEntry } from "./types";

function EnvironmentRow({
  serverId,
  entry,
  upgrading,
  lastResult,
  onUpgrade,
}: {
  serverId: string;
  entry: EnvironmentCheckEntry;
  upgrading: boolean;
  lastResult?: EnvironmentUpgradeEntry;
  onUpgrade: (provider: AgentProvider) => void;
}) {
  const handleUpgrade = useCallback(() => {
    onUpgrade(entry.provider);
  }, [entry.provider, onUpgrade]);
  return (
    <EnvironmentCard
      serverId={serverId}
      entry={entry}
      upgrading={upgrading}
      lastResult={lastResult}
      onUpgrade={handleUpgrade}
    />
  );
}

export function EnvironmentList({
  serverId,
  providers,
  upgradingProvider,
  lastResults,
  onUpgrade,
}: {
  serverId: string;
  providers: EnvironmentCheckEntry[];
  upgradingProvider: AgentProvider | null;
  lastResults: Partial<Record<AgentProvider, EnvironmentUpgradeEntry>>;
  onUpgrade: (provider: AgentProvider) => void;
}) {
  return (
    <View style={settingsStyles.card}>
      {providers.map((entry, index) => (
        <Fragment key={entry.provider}>
          {index > 0 ? <View style={styles.divider} /> : null}
          <EnvironmentRow
            serverId={serverId}
            entry={entry}
            upgrading={upgradingProvider === entry.provider}
            lastResult={lastResults[entry.provider]}
            onUpgrade={onUpgrade}
          />
        </Fragment>
      ))}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  divider: {
    height: 1,
    backgroundColor: theme.colors.border,
  },
}));
