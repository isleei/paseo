import { useCallback, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ChevronDown } from "lucide-react-native";
import { FileChangeIcon } from "@/components/file-change-icon";
import { MaterialFileIcon } from "@/components/material-file-icon";
import { CountChip, Section } from "@/components/ui/section";
import type { ParsedDiffFile } from "@/git/use-diff-query";
import type { Theme } from "@/styles/theme";

const ThemedChevronDown = withUnistyles(ChevronDown);

const chevronMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const chevronClosedTransform = { transform: [{ rotate: "-90deg" }] } as const;

/** Rows shown before the "more" row takes over, so this section cannot swallow the panel. */
const COLLAPSED_FILE_LIMIT = 6;

/**
 * File rows for the rail's Changes section. A row expands in place to name the change and offer a
 * way into the Changes view; it does not grow a diff of its own, so the rail stays a rail.
 */
export function ChangedFilesSection({
  files,
  divided,
  isExpanded,
  onToggleExpanded,
  expandedFilePaths,
  onToggleFile,
  openFile,
}: {
  files: readonly ParsedDiffFile[];
  divided: boolean;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  expandedFilePaths: ReadonlySet<string>;
  onToggleFile: (path: string) => void;
  openFile: (path: string) => void;
}): ReactElement {
  const { t } = useTranslation();
  const [showAll, setShowAll] = useState(false);
  const summary = useMemo(
    () => <CountChip label={String(files.length)} testID="workspace-rail-changes-count" />,
    [files.length],
  );
  const handleToggle = useCallback((path: string) => () => onToggleFile(path), [onToggleFile]);
  const handleOpen = useCallback((path: string) => () => openFile(path), [openFile]);
  const handleShowAll = useCallback(() => setShowAll(true), []);

  // A working tree with fifty files in it is ordinary, and fifty rows would bury every section
  // under this one. The header's count still reports the whole set.
  const visible = showAll ? files : files.slice(0, COLLAPSED_FILE_LIMIT);
  const hiddenCount = files.length - visible.length;

  return (
    <Section
      title={t("workspace.git.rail.changes")}
      open={isExpanded}
      onToggle={onToggleExpanded}
      summary={summary}
      variant="rail"
      divided={divided}
    >
      <View style={styles.list}>
        {visible.map((file) => (
          <ChangedFileRow
            key={file.path}
            file={file}
            isExpanded={expandedFilePaths.has(file.path)}
            onToggle={handleToggle(file.path)}
            onOpen={handleOpen(file.path)}
          />
        ))}
        {hiddenCount > 0 ? (
          <Pressable
            onPress={handleShowAll}
            accessibilityRole="button"
            testID="workspace-rail-changes-more"
            style={styles.moreRow}
          >
            <Text style={styles.moreLabel}>
              {t("workspace.git.rail.moreItems", { count: hiddenCount })}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </Section>
  );
}

function changeKind(file: ParsedDiffFile): "added" | "deleted" | "modified" {
  if (file.isNew) return "added";
  if (file.isDeleted) return "deleted";
  return "modified";
}

/** `+174 −0`, dropping each half when it is zero. U+2212, not a hyphen. */
function formatFileStat(file: ParsedDiffFile): string | null {
  const parts: string[] = [];
  if (file.additions > 0) parts.push(`+${file.additions}`);
  if (file.deletions > 0) parts.push(`−${file.deletions}`);
  return parts.length > 0 ? parts.join(" ") : null;
}

const ChangedFileRow = function ChangedFileRow({
  file,
  isExpanded,
  onToggle,
  onOpen,
}: {
  file: ParsedDiffFile;
  isExpanded: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const stat = formatFileStat(file);
  return (
    <View>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityLabel={file.path}
        testID={`workspace-rail-file-${file.path}`}
        style={styles.row}
      >
        <MaterialFileIcon fileName={file.path} size={15} />
        <Text style={styles.name} numberOfLines={1}>
          {file.path}
        </Text>
        {stat ? <Text style={styles.stat}>{stat}</Text> : null}
        <ThemedChevronDown
          size={13}
          uniProps={chevronMutedColorMapping}
          style={isExpanded ? undefined : chevronClosedTransform}
        />
      </Pressable>
      {isExpanded ? (
        <View style={styles.detail}>
          <FileChangeIcon change={changeKind(file)} />
          <Text style={styles.detailPath} numberOfLines={1}>
            {file.oldPath && file.oldPath !== file.path ? `${file.oldPath} → ` : ""}
            {file.path}
          </Text>
          <Pressable
            onPress={onOpen}
            accessibilityRole="button"
            style={styles.openButton}
            testID={`workspace-rail-file-open-${file.path}`}
          >
            <Text style={styles.openLabel}>diff</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create((theme) => ({
  list: {
    paddingHorizontal: theme.spacing[4],
    gap: theme.spacing[1],
  },
  moreRow: {
    paddingVertical: theme.spacing[1],
  },
  moreLabel: {
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[1],
  },
  name: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "auto",
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  stat: {
    flexShrink: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontVariant: ["tabular-nums"],
  },
  detail: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingLeft: theme.spacing[6],
    paddingVertical: theme.spacing[1],
  },
  detailPath: {
    flexGrow: 1,
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  openButton: {
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  openLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
