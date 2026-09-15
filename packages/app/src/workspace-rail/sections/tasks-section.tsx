import { useMemo, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { TaskListRow } from "@/components/task-list-row";
import { CountChip, Section } from "@/components/ui/section";
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
  const summary = useMemo(
    () => (
      <CountChip
        label={`${progress.completed}/${progress.total}`}
        testID="workspace-rail-task-progress"
      />
    ),
    [progress.completed, progress.total],
  );

  return (
    <Section
      title={t("message.todo.title")}
      open={open}
      onToggle={onToggle}
      summary={summary}
      variant="rail"
      divided={divided}
    >
      <View style={styles.list}>
        {tasks.map((task, index) => (
          <TaskListRow key={task.id ?? `${index}:${task.text}`} task={task} lines={TASK_LINES} />
        ))}
      </View>
    </Section>
  );
}

const styles = StyleSheet.create((theme) => ({
  list: {
    paddingHorizontal: theme.spacing[4],
    gap: theme.spacing[2],
  },
}));
