import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { getProviderIcon } from "@/components/provider-icons";
import { Button } from "@/components/ui/button";
import { StatusBadge, type StatusBadgeVariant } from "@/components/ui/status-badge";
import { copyText } from "@/plugins/react-native/clipboard";
import type { Theme } from "@/styles/theme";
import type { EnvironmentCheckEntry, EnvironmentUpgradeEntry } from "./types";

interface EnvironmentIconProps {
  iconKey: string;
  serverId?: string | null;
  size: number;
  color?: string;
}

function EnvironmentIcon({ iconKey, serverId, size, color = "" }: EnvironmentIconProps) {
  const Icon = getProviderIcon(iconKey, serverId);
  return <Icon size={size} color={color} />;
}

const ThemedEnvironmentIcon = withUnistyles(EnvironmentIcon);

const mutedIconColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

function statusBadge(entry: EnvironmentCheckEntry): {
  labelKey: string;
  variant: StatusBadgeVariant;
} {
  switch (entry.status) {
    case "ok":
      return { labelKey: "settings.environment.statuses.upToDate", variant: "success" };
    case "update-available":
      return { labelKey: "settings.environment.statuses.updateAvailable", variant: "warning" };
    case "check-failed":
    case "unavailable":
      return { labelKey: "settings.environment.statuses.checkFailed", variant: "error" };
    case "unknown-channel":
      return { labelKey: "settings.environment.statuses.unknownChannel", variant: "muted" };
  }
}

function versionLine(entry: EnvironmentCheckEntry): string | null {
  if (!entry.installedVersion) return null;
  if (entry.status === "update-available" && entry.latestVersion) {
    return `${entry.installedVersion} → ${entry.latestVersion}`;
  }
  return entry.installedVersion;
}

function upgradeButtonLabelKey(upgrading: boolean, failed: boolean): string {
  if (upgrading) return "settings.environment.upgrading";
  if (failed) return "settings.environment.retry";
  return "settings.environment.upgrade";
}

export function EnvironmentCard({
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
  onUpgrade: () => void;
}) {
  const { t } = useTranslation();
  const badge = statusBadge(entry);
  const versions = versionLine(entry);
  const canUpgrade = entry.status === "update-available" && entry.channel === "npm";
  const upgradeFailed = lastResult?.status === "failed" ? lastResult : null;

  const footer = useMemo(() => {
    const parts = [entry.packageName ?? null, entry.channel].filter(
      (part): part is string => typeof part === "string" && part.length > 0,
    );
    return parts.length > 0 ? parts.join(" · ") : null;
  }, [entry.channel, entry.packageName]);

  const showHint = Boolean(entry.upgradeHint) && !canUpgrade;
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const handleCopyHint = useCallback(async () => {
    if (!entry.upgradeHint) return;
    try {
      await copyText(entry.upgradeHint);
      setCopyFailed(false);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyFailed(true);
    }
  }, [entry.upgradeHint]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <ThemedEnvironmentIcon
          iconKey={entry.provider}
          serverId={serverId}
          size={14}
          uniProps={mutedIconColor}
        />
        <Text style={styles.name} numberOfLines={1}>
          {entry.label ?? entry.provider}
        </Text>
        <View style={styles.headerSpacer} />
        <StatusBadge label={t(badge.labelKey)} variant={badge.variant} />
      </View>

      {versions ? (
        <Text style={styles.versions} numberOfLines={1}>
          {versions}
        </Text>
      ) : null}

      {entry.error ? (
        <Text style={styles.error} numberOfLines={3}>
          {entry.error}
        </Text>
      ) : null}

      {upgradeFailed?.error ? (
        <Text style={styles.error} numberOfLines={3}>
          {upgradeFailed.error}
        </Text>
      ) : null}

      {footer ? (
        <Text style={styles.footer} numberOfLines={1}>
          {footer}
        </Text>
      ) : null}

      {showHint && entry.upgradeHint ? (
        <View style={styles.hintBlock}>
          <Text style={styles.hint} numberOfLines={2}>
            {entry.upgradeHint}
          </Text>
          <View style={styles.actions}>
            <Button
              variant="ghost"
              size="sm"
              onPress={handleCopyHint}
              accessibilityLabel={t("settings.environment.copyCommand")}
            >
              {t(copied ? "settings.environment.copied" : "settings.environment.copyCommand")}
            </Button>
          </View>
          {copyFailed ? (
            <Text style={styles.error} numberOfLines={2}>
              {t("settings.environment.copyFailed")}
            </Text>
          ) : null}
        </View>
      ) : null}

      {canUpgrade || upgradeFailed ? (
        <View style={styles.actions}>
          <Button
            variant="outline"
            size="sm"
            loading={upgrading}
            onPress={onUpgrade}
            accessibilityLabel={t("settings.environment.upgradeAccessibility", {
              name: entry.label ?? entry.provider,
            })}
          >
            {t(upgradeButtonLabelKey(upgrading, upgradeFailed !== null))}
          </Button>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[4],
    paddingHorizontal: theme.spacing[4],
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  name: {
    flexShrink: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  headerSpacer: {
    flex: 1,
  },
  versions: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  error: {
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.sm,
    lineHeight: theme.fontSize.sm * 1.4,
  },
  footer: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  hintBlock: {
    gap: theme.spacing[2],
  },
  hint: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  actions: {
    flexDirection: "row",
  },
}));
