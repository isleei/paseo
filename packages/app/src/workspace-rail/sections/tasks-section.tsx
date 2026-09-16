import { useMemo, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { TaskListRow } from "@/components/task-list-row";
import { Section } from "@/components/ui/section";
import type { TodoEntry } from "@/types/stream";
import { countCompletedTasks } from "@/workspace-rail/rail-state";

/** Long enough to use the rail's width, short enough that a list of them still fits on screen. */
const TASK_LINES = 2;

export function TasksSection({
  tasks,
  divided,
  open,
  onToggle,
}: {
  tasks: readonly TodoEntry[];
  divided: boolean;
  open: boolean;
  onToggle: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const progress = useMemo(() => countCompletedTasks(tasks), [tasks]);
  const isAllDone = progress.completed === progress.total && progress.total > 0;

  const summary = useMemo(
    () =>
      tasks.length > 0 ? (
        <View
          style={isAllDone ? styles.greenPill : styles.defaultPill}
          testID="workspace-rail-task-progress"
        >
          <Text style={isAllDone ? styles.greenPillText : styles.defaultPillText}>
            {`${progress.completed}/${progress.total}`}
          </Text>
        </View>
      ) : null,
    [isAllDone, progress.completed, progress.total, tasks.length],
  );

  return (
    <Section
      title={t("workspace.git.rail.tasksList", "任务清单")}
      open={open}
      onToggle={onToggle}
      summary={summary}
      variant="rail"
      divided={divided}
    >
      <View style={styles.list}>
        {tasks.length === 0 ? (
          <Text style={styles.emptyText}>{t("workspace.git.rail.noTasks", "暂无任务")}</Text>
        ) : (
          tasks.map((task, index) => (
            <TaskListRow
              key={task.id ?? `${index}:${task.text}`}
              task={task}
              lines={TASK_LINES}
              variant="rail"
            />
          ))
        )}
      </View>
    </Section>
  );
}

const styles = StyleSheet.create((theme) => ({
  list: {
    paddingHorizontal: theme.spacing[4],
    gap: theme.spacing[2],
  },
  emptyText: {
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.sm,
    paddingVertical: theme.spacing[1],
  },
  greenPill: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.statusSuccess + "20",
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.statusSuccess + "66",
    borderRadius: theme.borderRadius.full,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 1,
    minWidth: 26,
  },
  greenPillText: {
    fontSize: 11,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.statusSuccess,
  },
  defaultPill: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.interactionHighlight,
    borderRadius: theme.borderRadius.full,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 1,
    minWidth: 24,
  },
  defaultPillText: {
    fontSize: 11,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foregroundMuted,
  },
}));
