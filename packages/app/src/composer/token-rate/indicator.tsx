import { Fragment, memo, type ReactNode } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { formatCompactTokens } from "@/components/context-window-meter.utils";
import { useSessionStore } from "@/stores/session-store";
import type { Theme } from "@/styles/theme";
import {
  deriveSessionUsageTotals,
  formatCacheHitRate,
  formatTokensPerSecond,
  type SessionUsageTotals,
} from "./model";
import { useTokenRate } from "./use-token-rate";

interface TokenRateIndicatorProps {
  serverId: string;
  agentId: string;
}

interface TokenRateSegment {
  key: string;
  node: ReactNode;
}

function TokenRateIndicatorImpl({ serverId, agentId }: TokenRateIndicatorProps) {
  const { t } = useTranslation();
  const { tokensPerSecond } = useTokenRate(serverId, agentId);
  const usage = useSessionStore(
    (state) => state.sessions[serverId]?.agents?.get(agentId)?.lastUsage ?? null,
  );
  const totals: SessionUsageTotals | null = usage === null ? null : deriveSessionUsageTotals(usage);

  const segments: TokenRateSegment[] = [];
  if (tokensPerSecond !== null) {
    segments.push({
      key: "rate",
      node: (
        <Text style={styles.value} testID="composer-token-rate-value">
          {formatTokensPerSecond(tokensPerSecond)}
          <Text style={styles.label}> {t("composer.tokenRate.unit")}</Text>
        </Text>
      ),
    });
  }
  if (totals !== null && totals.totalTokens > 0) {
    segments.push({
      key: "total",
      node: (
        <Text style={styles.value} testID="composer-token-rate-total">
          {formatCompactTokens(totals.totalTokens)}
          <Text style={styles.label}> {t("composer.tokenRate.tokensLabel")}</Text>
        </Text>
      ),
    });
  }
  if (totals !== null && totals.cacheHitRate !== null) {
    segments.push({
      key: "cache",
      node: (
        <Text style={styles.value} testID="composer-token-rate-cache">
          {formatCacheHitRate(totals.cacheHitRate)}
          <Text style={styles.label}> {t("composer.tokenRate.cacheLabel")}</Text>
        </Text>
      ),
    });
  }

  if (segments.length === 0) return null;

  return (
    <View style={styles.container} testID="composer-token-rate">
      {segments.map((segment, index) => (
        <Fragment key={segment.key}>
          {index > 0 ? <Text style={styles.separator}>·</Text> : null}
          {segment.node}
        </Fragment>
      ))}
    </View>
  );
}

export const TokenRateIndicator = memo(TokenRateIndicatorImpl);

const styles = StyleSheet.create((theme: Theme) => ({
  container: {
    flexDirection: "row",
    alignItems: "baseline",
    alignSelf: "flex-end",
    flexWrap: "wrap",
    gap: theme.spacing[1],
  },
  value: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foregroundMuted,
    fontVariant: ["tabular-nums"],
  },
  label: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.foregroundExtraMuted,
  },
  separator: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundExtraMuted,
  },
}));
