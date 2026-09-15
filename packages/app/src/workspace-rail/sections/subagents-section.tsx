import { memo, useCallback, useMemo, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { getProviderIcon } from "@/components/provider-icons";
import { CountChip, Section } from "@/components/ui/section";
import {
  WorkspaceTabIcon,
  type WorkspaceTabPresentation,
} from "@/screens/workspace/workspace-tab-presentation";
import { useSubagentsForParent, type SubagentRow } from "@/subagents";
import { buildSubagentRowPresentationData } from "@/subagents/track-presentation";
import { navigateToAgent } from "@/utils/navigate-to-agent";

/**
 * Read-only fan-out list. Rows carry no archive or detach actions: the composer's subagents pill
 * owns those, and a second control surface for the same destructive action is a way to press the
 * wrong one.
 *
 * The rail does not ask this section whether it has anything to show — that answer needs a parent
 * agent, which the rail only knows as nullable. So the section subscribes for itself and draws its
 * own rule, which keeps a fan-out-less workspace from leaving a dangling divider at the bottom of
 * the panel.
 */
export function SubagentsSection({
  serverId,
  parentAgentId,
  divided,
  open,
  onToggle,
}: {
  serverId: string;
  parentAgentId: string;
  divided: boolean;
  open: boolean;
  onToggle: () => void;
}): ReactElement | null {
  const { t } = useTranslation();
  const rows = useSubagentsForParent({ serverId, parentAgentId });

  const handleOpen = useCallback(
    (row: SubagentRow) => {
      // A provider-native subagent has no route of its own; opening the parent would be a lie
      // dressed up as navigation, so those rows stay inert until the rail can host tab targets.
      if (row.kind !== "paseo") {
        return;
      }
      navigateToAgent({ serverId, agentId: row.id });
    },
    [serverId],
  );

  const summary = useMemo(() => <CountChip label={String(rows.length)} />, [rows.length]);

  if (rows.length === 0) {
    return null;
  }

  return (
    <Section
      title={t("subagents.title")}
      open={open}
      onToggle={onToggle}
      summary={summary}
      variant="rail"
      divided={divided}
    >
      <View style={styles.list}>
        {rows.map((row) => (
          <SubagentRowView key={row.id} row={row} serverId={serverId} onOpen={handleOpen} />
        ))}
      </View>
    </Section>
  );
}

const SubagentRowView = memo(function SubagentRowView({
  row,
  serverId,
  onOpen,
}: {
  row: SubagentRow;
  serverId: string;
  onOpen: (row: SubagentRow) => void;
}) {
  const { t } = useTranslation();
  const presentation = useMemo<WorkspaceTabPresentation>(() => {
    const data = buildSubagentRowPresentationData(row);
    return {
      ...data,
      tooltip: data.label,
      modified: false,
      icon: getProviderIcon(row.provider, serverId),
    };
  }, [row, serverId]);
  const label =
    presentation.titleState === "loading" ? t("common.states.loading") : presentation.label;
  const handlePress = useCallback(() => onOpen(row), [onOpen, row]);

  return (
    <Pressable
      onPress={handlePress}
      disabled={row.kind !== "paseo"}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={`workspace-rail-subagent-${row.id}`}
      style={styles.row}
    >
      <WorkspaceTabIcon presentation={presentation} backdrop="surface1" />
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
      {presentation.subtitle ? (
        <Text style={styles.subtitle} numberOfLines={1}>
          {presentation.subtitle}
        </Text>
      ) : null}
    </Pressable>
  );
});

const styles = StyleSheet.create((theme) => ({
  list: {
    paddingHorizontal: theme.spacing[4],
    gap: theme.spacing[2],
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  label: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "auto",
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  subtitle: {
    flexShrink: 2,
    minWidth: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
