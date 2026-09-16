import { useCallback, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ChevronDown, ChevronRight } from "lucide-react-native";
import { MaterialFileIcon } from "@/components/material-file-icon";
import { CountChip, Section } from "@/components/ui/section";
import type { Theme } from "@/styles/theme";
import { basenameOfRailPath } from "@/workspace-rail/rail-paths";
import type { RailWebSource } from "@/workspace-rail/rail-state";

const ThemedChevronRight = withUnistyles(ChevronRight);
const ThemedChevronDown = withUnistyles(ChevronDown);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/**
 * What the session reached for: the web, the files it read, and whatever the user attached.
 *
 * The three groups share one section because they answer one question — "where did this come
 * from?" — and each is capped by the derivation, so the section cannot grow without bound.
 */
export function SourcesSection({
  webSources,
  projectFiles,
  uploadedCount,
  divided,
  isExpanded,
  onToggleExpanded,
  onOpenWebSource,
  onOpenProjectFile,
}: {
  webSources: readonly RailWebSource[];
  projectFiles: readonly string[];
  /** Uploads live in a client store the rail reads for its count; the composer owns their rows. */
  uploadedCount: number;
  divided: boolean;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  onOpenWebSource: (source: RailWebSource) => void;
  onOpenProjectFile: (path: string) => void;
}): ReactElement {
  const { t } = useTranslation();
  const [isProjectFilesExpanded, setIsProjectFilesExpanded] = useState(true);
  const handleToggleProjectFiles = useCallback(
    () => setIsProjectFilesExpanded((prev) => !prev),
    [],
  );
  const total = webSources.length + projectFiles.length + (uploadedCount > 0 ? 1 : 0);
  const summary = useMemo(
    () =>
      total > 0 ? <CountChip label={String(total)} testID="workspace-rail-sources-count" /> : null,
    [total],
  );

  return (
    <Section
      title={t("workspace.git.rail.sources")}
      open={isExpanded}
      onToggle={onToggleExpanded}
      summary={summary}
      variant="rail"
      divided={divided}
    >
      <View style={styles.list}>
        {total === 0 ? (
          <Text style={styles.emptyText}>{t("workspace.git.rail.noSources", "暂无参考")}</Text>
        ) : (
          <>
            {webSources.length > 0 ? (
              <Text style={styles.groupLabel}>{t("workspace.git.rail.sourcesWeb")}</Text>
            ) : null}
            {webSources.map((source) => (
              <SourceRow
                key={source.url ?? source.label}
                label={source.label}
                onPress={onOpenWebSource}
                payload={source}
                testID={`workspace-rail-source-web-${source.url ?? source.label}`}
              />
            ))}

            {uploadedCount > 0 ? (
              <>
                <Text style={styles.groupLabel}>{t("workspace.git.rail.sourcesUpload")}</Text>
                <View style={styles.row}>
                  <Text style={styles.name}>
                    {t("workspace.git.rail.uploadedCount", { count: uploadedCount })}
                  </Text>
                </View>
              </>
            ) : null}

            {projectFiles.length > 0 ? (
              <Pressable
                onPress={handleToggleProjectFiles}
                style={styles.subGroupHeader}
                accessibilityRole="button"
                accessibilityLabel={t("workspace.git.rail.sourcesProject")}
                testID="workspace-rail-sources-project-toggle"
              >
                <View style={styles.subGroupHeaderLeft}>
                  {isProjectFilesExpanded ? (
                    <ThemedChevronDown size={12} uniProps={mutedColorMapping} />
                  ) : (
                    <ThemedChevronRight size={12} uniProps={mutedColorMapping} />
                  )}
                  <Text style={styles.groupLabel}>{t("workspace.git.rail.sourcesProject")}</Text>
                </View>
                <Text style={styles.subGroupCount}>{projectFiles.length}</Text>
              </Pressable>
            ) : null}
            {isProjectFilesExpanded
              ? projectFiles.map((path) => (
                  <SourceRow
                    key={path}
                    label={basenameOfRailPath(path)}
                    secondary={path}
                    iconFileName={path}
                    onPress={onOpenProjectFile}
                    payload={path}
                    testID={`workspace-rail-source-file-${path}`}
                  />
                ))
              : null}
          </>
        )}
      </View>
    </Section>
  );
}

function SourceRow<T>({
  label,
  secondary,
  iconFileName,
  payload,
  onPress,
  testID,
}: {
  label: string;
  secondary?: string;
  /** Naming the file is enough for the row to draw its icon; passing an element would re-render it. */
  iconFileName?: string;
  payload: T;
  onPress: (payload: T) => void;
  testID: string;
}): ReactElement {
  const handlePress = useCallback(() => onPress(payload), [onPress, payload]);
  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={secondary ?? label}
      testID={testID}
      style={styles.row}
    >
      {iconFileName ? <MaterialFileIcon fileName={iconFileName} size={15} /> : null}
      <Text style={styles.name} numberOfLines={1}>
        {label}
      </Text>
      {secondary ? (
        <Text style={styles.secondary} numberOfLines={1}>
          {secondary}
        </Text>
      ) : null}
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
  secondary: {
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
  subGroupHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[1],
  },
  subGroupHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  subGroupCount: {
    fontSize: 11,
    color: theme.colors.foregroundExtraMuted,
    fontFamily: theme.fontFamily.mono,
  },
}));
