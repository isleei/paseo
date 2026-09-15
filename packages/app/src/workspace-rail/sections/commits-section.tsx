import { memo, useMemo, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { CountChip, Section } from "@/components/ui/section";
import type { ClassifiedCheckoutCommit } from "@/git/use-commits-query";

/**
 * Commits this branch has ahead of its base — the working branch's own history, newest first.
 *
 * It reads with a fetch rather than a push subscription, which is what lets the rail own the list:
 * the diff and terminals domains are served by the server-data push router, and a query mounted
 * where the rail lives never opens a subscription there.
 */
export function CommitsSection({
  commits,
  divided,
  open,
  onToggle,
}: {
  commits: readonly ClassifiedCheckoutCommit[];
  divided: boolean;
  open: boolean;
  onToggle: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const summary = useMemo(() => <CountChip label={String(commits.length)} />, [commits.length]);
  const visible = useMemo(() => commits.slice(0, MAX_VISIBLE_COMMITS), [commits]);
  const hiddenCount = commits.length - visible.length;

  return (
    <Section
      title={t("workspace.git.rail.commits")}
      open={open}
      onToggle={onToggle}
      summary={summary}
      variant="rail"
      divided={divided}
    >
      <View style={styles.list}>
        {visible.map((commit) => (
          <CommitRow key={commit.sha} commit={commit} />
        ))}
        {hiddenCount > 0 ? (
          <Text style={styles.note}>
            {t("workspace.git.rail.moreItems", { count: hiddenCount })}
          </Text>
        ) : null}
      </View>
    </Section>
  );
}

/** Enough to name the branch's shape without turning the rail into a log viewer. */
const MAX_VISIBLE_COMMITS = 5;

const CommitRow = memo(function CommitRow({ commit }: { commit: ClassifiedCheckoutCommit }) {
  return (
    <View style={styles.row} accessibilityLabel={`${commit.shortSha} ${commit.subject}`}>
      <Text style={styles.sha} numberOfLines={1}>
        {commit.shortSha}
      </Text>
      <Text style={styles.subject} numberOfLines={1}>
        {commit.subject}
      </Text>
    </View>
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
  sha: {
    color: theme.colors.foregroundMuted,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.sm,
  },
  subject: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "auto",
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  note: {
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.sm,
  },
}));
