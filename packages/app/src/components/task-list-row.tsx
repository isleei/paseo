import { Circle, CircleCheck, CircleDot } from "lucide-react-native";
import { memo } from "react";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";
import type { TodoEntry } from "@/types/stream";

const ThemedCircle = withUnistyles(Circle);
const ThemedCircleCheck = withUnistyles(CircleCheck);
const ThemedCircleDot = withUnistyles(CircleDot);

const extraMutedIcon = (theme: Theme) => ({ color: theme.colors.foregroundExtraMuted });
const runningIcon = (theme: Theme) => ({ color: theme.colors.statusDotRunning });
const successIcon = (theme: Theme) => ({ color: theme.colors.statusSuccess });

function TaskStatusIcon({
  isCompleted,
  isRunning,
  isRail,
}: {
  isCompleted: boolean;
  isRunning: boolean;
  isRail?: boolean;
}) {
  if (isCompleted) {
    return <ThemedCircleCheck size={16} uniProps={isRail ? successIcon : extraMutedIcon} />;
  }
  if (isRunning) {
    return <ThemedCircleDot size={16} uniProps={runningIcon} />;
  }
  // A pending task's ring is a status mark, not a checkbox. At the muted step it carries the
  // weight of an enabled control and invites a click that does nothing, so it sits one step back
  // from the text it marks.
  return <ThemedCircle size={16} uniProps={extraMutedIcon} />;
}

export const TaskListRow = memo(function TaskListRow({
  task,
  lines = 1,
  variant = "default",
}: {
  task: TodoEntry;
  /** The rail's rows wrap; the composer's panel measures against a pill and cannot. */
  lines?: number;
  variant?: "default" | "rail";
}) {
  const isCompleted = task.completed || task.status === "completed";
  const isRunning = !isCompleted && task.status === "in_progress";
  const text = isRunning && task.activeForm ? task.activeForm : task.text;
  const isRail = variant === "rail";

  return (
    <View style={styles.row} accessibilityLabel={text}>
      <View style={styles.iconWrap}>
        <TaskStatusIcon isCompleted={isCompleted} isRunning={isRunning} isRail={isRail} />
      </View>
      <Text
        numberOfLines={lines}
        style={[
          styles.text,
          isRunning && styles.runningText,
          isCompleted && (isRail ? styles.railCompletedText : styles.completedText),
        ]}
      >
        {text}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
    paddingVertical: 2,
  },
  iconWrap: {
    marginTop: 2,
    flexShrink: 0,
  },
  // Grows and shrinks, but keeps an `auto` basis: a zero-basis label reports no intrinsic width,
  // and a container that sizes itself to its content — the composer track panel — measures the
  // row as empty and truncates it against a surface that had room to spare.
  text: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "auto",
    minWidth: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  runningText: {
    color: theme.colors.foreground,
  },
  completedText: {
    color: theme.colors.foregroundExtraMuted,
    textDecorationLine: "line-through",
  },
  railCompletedText: {
    color: theme.colors.foreground,
    textDecorationLine: "none",
  },
}));
