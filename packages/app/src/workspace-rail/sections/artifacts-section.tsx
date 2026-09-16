import { useCallback, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { MaterialFileIcon } from "@/components/material-file-icon";
import { CountChip, Section } from "@/components/ui/section";
import type { RailArtifact } from "@/workspace-rail/rail-state";
import { basenameOfRailPath } from "@/workspace-rail/rail-paths";

/** Rows shown before the panel is asked to grow; the chip still reports the whole set. */
const COLLAPSED_ARTIFACT_LIMIT = 5;

/**
 * Files the session produced, split the way the reference panel splits them: the files it wrote
 * outright, then the ones it edited in place under a quieter heading.
 *
 * A write and a later edit of the same path collapse to one row, keyed by path, because the rail
 * names files and not edits — the timeline already shows every edit individually.
 */
export function ArtifactsSection({
  artifacts,
  divided,
  isExpanded,
  onToggleExpanded,
  onOpenArtifact,
}: {
  artifacts: readonly RailArtifact[];
  divided: boolean;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  onOpenArtifact: (path: string) => void;
}): ReactElement {
  const { t } = useTranslation();
  const [showAll, setShowAll] = useState(false);
  const { produced, intermediate } = useMemo(() => splitArtifacts(artifacts), [artifacts]);
  const summary = useMemo(
    () =>
      artifacts.length > 0 ? (
        <CountChip label={String(artifacts.length)} testID="workspace-rail-artifacts-count" />
      ) : null,
    [artifacts.length],
  );
  const visibleProduced = showAll ? produced : produced.slice(0, COLLAPSED_ARTIFACT_LIMIT);
  const hiddenCount = produced.length - visibleProduced.length;
  const handleShowAll = useCallback(() => setShowAll(true), []);

  return (
    <Section
      title={t("workspace.git.rail.artifacts")}
      open={isExpanded}
      onToggle={onToggleExpanded}
      summary={summary}
      variant="rail"
      divided={divided}
    >
      <View style={styles.list}>
        {artifacts.length === 0 ? (
          <Text style={styles.emptyText}>{t("workspace.git.rail.noArtifacts", "暂无产物")}</Text>
        ) : (
          <>
            {visibleProduced.map((artifact) => (
              <ArtifactRow key={artifact.path} artifact={artifact} onOpen={onOpenArtifact} />
            ))}
            {hiddenCount > 0 ? (
              <Pressable
                onPress={handleShowAll}
                accessibilityRole="button"
                testID="workspace-rail-artifacts-more"
                style={styles.moreRow}
              >
                <Text style={styles.moreText}>
                  {t("workspace.git.rail.moreItems", { count: hiddenCount })}
                </Text>
              </Pressable>
            ) : null}
            {intermediate.length > 0 ? (
              <>
                <Text style={styles.groupLabel}>
                  {t("workspace.git.rail.artifactsIntermediate")}
                </Text>
                {intermediate.map((artifact) => (
                  <ArtifactRow key={artifact.path} artifact={artifact} onOpen={onOpenArtifact} />
                ))}
              </>
            ) : null}
          </>
        )}
      </View>
    </Section>
  );
}

function splitArtifacts(artifacts: readonly RailArtifact[]): {
  produced: RailArtifact[];
  intermediate: RailArtifact[];
} {
  const produced: RailArtifact[] = [];
  const intermediate: RailArtifact[] = [];
  for (const artifact of artifacts) {
    if (artifact.kind === "produced") produced.push(artifact);
    else intermediate.push(artifact);
  }
  return { produced, intermediate };
}

function ArtifactRow({
  artifact,
  onOpen,
}: {
  artifact: RailArtifact;
  onOpen: (path: string) => void;
}): ReactElement {
  const handlePress = useCallback(() => onOpen(artifact.path), [artifact.path, onOpen]);
  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={artifact.path}
      testID={`workspace-rail-artifact-${artifact.path}`}
      style={styles.row}
    >
      <MaterialFileIcon fileName={artifact.path} size={15} />
      <Text style={styles.name} numberOfLines={1}>
        {basenameOfRailPath(artifact.path)}
      </Text>
      <Text style={styles.dir} numberOfLines={1}>
        {basenameOfRailPath(artifact.path) === artifact.path ? "" : artifact.path}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  list: {
    paddingHorizontal: theme.spacing[4],
    gap: theme.spacing[1],
  },
  emptyText: {
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.sm,
    paddingVertical: theme.spacing[1],
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[1],
  },
  name: {
    flexShrink: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  dir: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "auto",
    minWidth: 0,
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.sm,
  },
  groupLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    paddingTop: theme.spacing[2],
  },
  moreRow: {
    paddingVertical: theme.spacing[1],
  },
  moreText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
