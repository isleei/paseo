import { useMemo, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Sparkles } from "lucide-react-native";
import { CountChip, Section } from "@/components/ui/section";
import type { Theme } from "@/styles/theme";
import type { RailSkillUse } from "@/workspace-rail/rail-state";

const ThemedSparkles = withUnistyles(Sparkles);

const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/**
 * Skills the session invoked, counted.
 *
 * A skill is a `Skill` tool call; the same one called four times is one row reporting four, not
 * four identical rows. Rows are inert: a skill has no destination of its own, and the transcript
 * already shows each invocation where it happened.
 */
export function SkillsSection({
  skills,
  divided,
  isExpanded,
  onToggleExpanded,
}: {
  skills: readonly RailSkillUse[];
  divided: boolean;
  isExpanded: boolean;
  onToggleExpanded: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const summary = useMemo(
    () => <CountChip label={String(skills.length)} testID="workspace-rail-skills-count" />,
    [skills.length],
  );

  return (
    <Section
      title={t("workspace.git.rail.skills")}
      open={isExpanded}
      onToggle={onToggleExpanded}
      summary={summary}
      variant="rail"
      divided={divided}
    >
      <View style={styles.list}>
        {skills.map((skill) => (
          <View
            key={skill.name}
            style={styles.row}
            accessibilityLabel={`${skill.name} ×${skill.count}`}
            testID={`workspace-rail-skill-${skill.name}`}
          >
            <ThemedSparkles size={14} uniProps={mutedColorMapping} />
            <Text style={styles.name} numberOfLines={1}>
              {skill.name}
            </Text>
            {skill.count > 1 ? <Text style={styles.count}>×{skill.count}</Text> : null}
          </View>
        ))}
      </View>
    </Section>
  );
}

const styles = StyleSheet.create((theme) => ({
  list: {
    paddingHorizontal: theme.spacing[4],
    gap: theme.spacing[1],
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
  count: {
    flexShrink: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontVariant: ["tabular-nums"],
  },
}));
