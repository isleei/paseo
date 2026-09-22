import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { usePaseo, useRpc } from "@getpaseo/plugin/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View, type ViewStyle } from "react-native";
import {
  TASK_STATUSES,
  createTaskRpc,
  deleteTaskRpc,
  dispatchTaskRpc,
  latestTaskRun,
  listTasksRpc,
  moveTaskRpc,
  type Task,
  type TaskStatus,
} from "../shared/todo";
import { STRINGS, pickLocale, type TasksLocale, type TasksStrings } from "../shared/strings";
import { agentBadge, useAgentSnapshots, type AgentSnapshotSource } from "./agent-status";
import { ProviderPicker, type ProviderSelection } from "./provider-picker";
import { getWebLanguage } from "./web";

const NEXT: Record<TaskStatus, TaskStatus | null> = {
  inbox: "planning",
  planning: null,
  in_progress: "review",
  review: "done",
  done: null,
};

const ENABLED_STATE = { disabled: false };
const DISABLED_STATE = { disabled: true };

interface BoardStyles {
  detail: { color: string; fontSize: number };
  goal: { color: string; fontSize: number };
  error: { color: string; fontSize?: number };
  column: ViewStyle;
  columnHeader: { color: string; fontSize: number; fontWeight: "600" };
  card: ViewStyle;
  cardHeader: ViewStyle;
  cardTitle: { color: string; fontSize: number; flex: number };
  deleteText: { color: string; fontSize: number };
  agentActive: { color: string; fontSize: number };
  agentWarn: { color: string; fontSize: number };
  agentDanger: { color: string; fontSize: number };
  actionsRow: ViewStyle;
  primaryButton: ViewStyle;
  primaryButtonText: { color: string; textAlign: "center"; fontSize: number };
  secondaryButton: ViewStyle;
  secondaryButtonText: { color: string; textAlign: "center"; fontSize: number };
  dots: Record<TaskStatus, ViewStyle>;
}

function TaskCard({
  task,
  styles,
  strings,
  agentSource,
  starting,
  onRun,
  onMove,
  onDelete,
  onOpenAgent,
}: {
  task: Task;
  styles: BoardStyles;
  strings: TasksStrings;
  agentSource: AgentSnapshotSource;
  starting: boolean;
  onRun: (id: string) => void;
  onMove: (id: string, status: TaskStatus) => void;
  onDelete: (id: string) => void;
  onOpenAgent?: (agentId: string) => void;
}) {
  const latestRun = latestTaskRun(task);
  const next = NEXT[task.status];
  const runnable = task.status !== "done" && latestRun?.outcome !== "running";
  const runActionLabel = task.runs.length > 0 ? strings.runAgain : strings.run;
  const runButtonLabel = starting ? strings.starting : runActionLabel;
  const badge = useMemo(
    () => agentBadge(latestRun?.agentId ?? null, agentSource, strings),
    [latestRun?.agentId, agentSource, strings],
  );
  const badgeStyle = useMemo(() => {
    switch (badge.tone) {
      case "active":
        return styles.agentActive;
      case "warn":
        return styles.agentWarn;
      case "danger":
        return styles.agentDanger;
      default:
        return styles.detail;
    }
  }, [badge, styles]);
  const handleRun = useCallback(() => onRun(task.id), [onRun, task.id]);
  const handleDelete = useCallback(() => onDelete(task.id), [onDelete, task.id]);
  const handleOpenAgent = useCallback(() => {
    if (latestRun && onOpenAgent) onOpenAgent(latestRun.agentId);
  }, [latestRun, onOpenAgent]);
  const handleMove = useCallback(() => {
    if (next) onMove(task.id, next);
  }, [next, onMove, task.id]);

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.dots[task.status]} />
        <Text style={styles.cardTitle}>{task.title}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${strings.deleteAction} ${task.title}`}
          onPress={handleDelete}
        >
          <Text style={styles.deleteText}>✕</Text>
        </Pressable>
      </View>
      {task.goal ? (
        <Text style={styles.goal} numberOfLines={2}>
          {task.goal}
        </Text>
      ) : null}
      <Text style={badgeStyle}>{badge.text}</Text>
      <Text style={styles.detail}>
        {task.runs.length} {strings.executionCount}
      </Text>
      {latestRun?.branch ? <Text style={styles.detail}>⎇ {latestRun.branch}</Text> : null}
      {latestRun?.error ? <Text style={styles.error}>{latestRun.error}</Text> : null}
      {runnable || next || (latestRun && onOpenAgent) ? (
        <View style={styles.actionsRow}>
          {runnable ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${runActionLabel} ${task.title}`}
              accessibilityState={starting ? DISABLED_STATE : ENABLED_STATE}
              disabled={starting}
              style={styles.primaryButton}
              onPress={handleRun}
            >
              <Text style={styles.primaryButtonText}>{runButtonLabel}</Text>
            </Pressable>
          ) : null}
          {latestRun && onOpenAgent ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${strings.openAgent} ${task.title}`}
              style={styles.secondaryButton}
              onPress={handleOpenAgent}
            >
              <Text style={styles.secondaryButtonText}>{strings.openAgent}</Text>
            </Pressable>
          ) : null}
          {next ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${strings.moveAction} ${strings.statusName[next]}`}
              style={styles.secondaryButton}
              onPress={handleMove}
            >
              <Text style={styles.secondaryButtonText}>→ {strings.statusName[next]}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function TaskColumn({
  status,
  tasks,
  styles,
  strings,
  agentSource,
  starting,
  onRun,
  onMove,
  onDelete,
  onOpenAgent,
}: {
  status: TaskStatus;
  tasks: readonly Task[];
  styles: BoardStyles;
  strings: TasksStrings;
  agentSource: AgentSnapshotSource;
  starting: boolean;
  onRun: (id: string) => void;
  onMove: (id: string, status: TaskStatus) => void;
  onDelete: (id: string) => void;
  onOpenAgent?: (agentId: string) => void;
}) {
  const columnTasks = tasks.filter((task) => task.status === status);
  return (
    <View style={styles.column}>
      <Text style={styles.columnHeader}>
        {strings.statusName[status]} · {columnTasks.length}
      </Text>
      {columnTasks.length === 0 ? <Text style={styles.detail}>{strings.empty}</Text> : null}
      {columnTasks.map((task) => (
        <TaskCard
          key={task.id}
          task={task}
          styles={styles}
          strings={strings}
          agentSource={agentSource}
          starting={starting}
          onRun={onRun}
          onMove={onMove}
          onDelete={onDelete}
          onOpenAgent={onOpenAgent}
        />
      ))}
    </View>
  );
}

function dotStyle(color: string): ViewStyle {
  return { width: 8, height: 8, borderRadius: 4, backgroundColor: color };
}

export function TasksBoard({ theme, layout, navigation }: PluginSurfaceProps) {
  const paseo = usePaseo();
  const listTasks = useRpc(listTasksRpc);
  const createTask = useRpc(createTaskRpc);
  const moveTask = useRpc(moveTaskRpc);
  const dispatchTask = useRpc(dispatchTaskRpc);
  const deleteTask = useRpc(deleteTaskRpc);
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [cwd, setCwd] = useState("");
  const [providerSelection, setProviderSelection] = useState<ProviderSelection | null>(null);
  const [locale, setLocale] = useState<TasksLocale>(() => pickLocale(getWebLanguage()));
  const [formError, setFormError] = useState<string | null>(null);
  const strings = STRINGS[locale];
  const agentSource = useAgentSnapshots(paseo);
  const tasksQuery = useQuery({
    queryKey: ["tasks"],
    queryFn: () => listTasks({}),
    refetchInterval: 3_000,
  });
  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["tasks"] });
  }, [queryClient]);
  const createMutation = useMutation({
    mutationFn: createTask,
    onSuccess: () => {
      setTitle("");
      setGoal("");
      setFormError(null);
      invalidate();
    },
  });
  const moveMutation = useMutation({ mutationFn: moveTask, onSuccess: invalidate });
  const dispatchMutation = useMutation({
    mutationFn: dispatchTask,
    onSuccess: () => {
      setFormError(null);
      invalidate();
    },
  });
  const deleteMutation = useMutation({ mutationFn: deleteTask, onSuccess: invalidate });

  const handleCreate = useCallback(() => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;
    const trimmedGoal = goal.trim();
    createMutation.mutate({ title: trimmedTitle, goal: trimmedGoal || undefined });
  }, [createMutation, goal, title]);
  const handleRun = useCallback(
    (id: string) => {
      const trimmedCwd = cwd.trim();
      if (!trimmedCwd || !providerSelection?.provider || !providerSelection.model) {
        setFormError(strings.runSetupRequired);
        return;
      }
      dispatchMutation.mutate({
        id,
        cwd: trimmedCwd,
        provider: providerSelection.provider,
        model: providerSelection.model,
      });
    },
    [cwd, dispatchMutation, providerSelection, strings.runSetupRequired],
  );
  const handleMove = useCallback(
    (id: string, status: TaskStatus) => moveMutation.mutate({ id, status }),
    [moveMutation],
  );
  const handleDelete = useCallback((id: string) => deleteMutation.mutate({ id }), [deleteMutation]);
  const handleOpenAgent = useCallback(
    (agentId: string) => navigation?.openAgent({ agentId }),
    [navigation],
  );
  const handleToggleLocale = useCallback(
    () => setLocale((current) => (current === "en" ? "zh-CN" : "en")),
    [],
  );

  const compact = layout.compact;
  const styles = useMemo(
    () => ({
      screen: {
        flex: 1,
        padding: compact ? 16 : 24,
        gap: 12,
        backgroundColor: theme.colors.surface0,
      },
      detail: { color: theme.colors.foregroundMuted, fontSize: 13 },
      createCard: {
        gap: 8,
        padding: 12,
        borderRadius: 12,
        backgroundColor: theme.colors.surface1,
        borderWidth: 1,
        borderColor: theme.colors.border,
      },
      input: {
        padding: 10,
        borderRadius: 8,
        color: theme.colors.foreground,
        backgroundColor: theme.colors.surface0,
        borderWidth: 1,
        borderColor: theme.colors.border,
      },
      columns: compact ? { gap: 16 } : { gap: 12, paddingBottom: 8 },
      column: compact ? { gap: 8 } : { width: 280, gap: 8 },
      headerRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
      headerTitle: { color: theme.colors.foreground, fontSize: compact ? 20 : 24, flex: 1 },
      columnHeader: { color: theme.colors.foreground, fontSize: 14, fontWeight: "600" as const },
      card: {
        padding: 12,
        borderRadius: 10,
        gap: 8,
        backgroundColor: theme.colors.surface1,
        borderWidth: 1,
        borderColor: theme.colors.border,
      },
      cardHeader: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
      cardTitle: { color: theme.colors.foreground, fontSize: 14, flex: 1 },
      deleteText: { color: theme.colors.statusDanger, fontSize: 14 },
      agentActive: { color: theme.colors.accent, fontSize: 13 },
      agentWarn: { color: theme.colors.statusWarning, fontSize: 13 },
      agentDanger: { color: theme.colors.statusDanger, fontSize: 13 },
      goal: { color: theme.colors.foreground, fontSize: 13 },
      actionsRow: { flexDirection: "row" as const, gap: 8 },
      primaryButton: {
        padding: 8,
        borderRadius: 8,
        backgroundColor: theme.colors.accent,
        flex: 1,
      },
      primaryButtonText: {
        color: theme.colors.accentForeground,
        textAlign: "center" as const,
        fontSize: 13,
      },
      secondaryButton: {
        padding: 8,
        borderRadius: 8,
        backgroundColor: "transparent",
        borderWidth: 1,
        borderColor: theme.colors.border,
        flex: 1,
      },
      secondaryButtonText: {
        color: theme.colors.foreground,
        textAlign: "center" as const,
        fontSize: 13,
      },
      createButton: { padding: 12, borderRadius: 10, backgroundColor: theme.colors.accent },
      localeButton: {
        paddingVertical: 6,
        paddingHorizontal: 12,
        borderRadius: 8,
        backgroundColor: "transparent",
        borderWidth: 1,
        borderColor: theme.colors.border,
      },
      createButtonText: {
        color: theme.colors.accentForeground,
        textAlign: "center" as const,
        fontSize: 14,
      },
      error: { color: theme.colors.statusDanger, fontSize: 13 },
    }),
    [compact, theme],
  );

  const cardStyles = useMemo<BoardStyles>(
    () => ({
      detail: styles.detail,
      goal: styles.goal,
      error: styles.error,
      column: styles.column,
      columnHeader: styles.columnHeader,
      card: styles.card,
      cardHeader: styles.cardHeader,
      cardTitle: styles.cardTitle,
      deleteText: styles.deleteText,
      agentActive: styles.agentActive,
      agentWarn: styles.agentWarn,
      agentDanger: styles.agentDanger,
      actionsRow: styles.actionsRow,
      primaryButton: styles.primaryButton,
      primaryButtonText: styles.primaryButtonText,
      secondaryButton: styles.secondaryButton,
      secondaryButtonText: styles.secondaryButtonText,
      dots: {
        inbox: dotStyle(theme.colors.foregroundMuted),
        planning: dotStyle(theme.colors.statusWarning),
        in_progress: dotStyle(theme.colors.accent),
        review: dotStyle(theme.colors.statusWarning),
        done: dotStyle(theme.colors.statusSuccess),
      },
    }),
    [styles, theme],
  );

  const tasks = useMemo(() => tasksQuery.data?.tasks ?? [], [tasksQuery.data]);
  const error =
    formError ??
    tasksQuery.error?.message ??
    createMutation.error?.message ??
    moveMutation.error?.message ??
    dispatchMutation.error?.message ??
    deleteMutation.error?.message ??
    null;
  const placeholderColor = theme.colors.foregroundMuted;
  const columnList = TASK_STATUSES.map((status) => (
    <TaskColumn
      key={status}
      status={status}
      tasks={tasks}
      styles={cardStyles}
      strings={strings}
      agentSource={agentSource}
      starting={dispatchMutation.isPending}
      onRun={handleRun}
      onMove={handleMove}
      onDelete={handleDelete}
      onOpenAgent={navigation ? handleOpenAgent : undefined}
    />
  ));

  return (
    <View style={styles.screen}>
      <View style={styles.headerRow}>
        <Text style={styles.headerTitle}>{strings.boardTitle}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={strings.switchLanguageLabel}
          style={styles.localeButton}
          onPress={handleToggleLocale}
        >
          <Text style={styles.secondaryButtonText}>{strings.switchLanguageLabel}</Text>
        </Pressable>
      </View>
      <Text style={styles.detail}>{strings.boardSubtitle}</Text>
      <View style={styles.createCard}>
        <TextInput
          accessibilityLabel={strings.titlePlaceholder}
          placeholder={strings.titlePlaceholder}
          placeholderTextColor={placeholderColor}
          value={title}
          onChangeText={setTitle}
          style={styles.input}
        />
        <TextInput
          accessibilityLabel={strings.goalPlaceholder}
          placeholder={strings.goalPlaceholder}
          placeholderTextColor={placeholderColor}
          value={goal}
          onChangeText={setGoal}
          multiline={true}
          style={styles.input}
        />
        <TextInput
          accessibilityLabel={strings.cwdPlaceholder}
          placeholder={strings.cwdPlaceholder}
          placeholderTextColor={placeholderColor}
          value={cwd}
          onChangeText={setCwd}
          style={styles.input}
        />
        <ProviderPicker
          paseo={paseo}
          theme={theme}
          strings={strings}
          selection={providerSelection}
          onSelection={setProviderSelection}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={strings.create}
          accessibilityState={createMutation.isPending ? DISABLED_STATE : ENABLED_STATE}
          disabled={createMutation.isPending}
          style={styles.createButton}
          onPress={handleCreate}
        >
          <Text style={styles.createButtonText}>
            {createMutation.isPending ? strings.creating : strings.create}
          </Text>
        </Pressable>
      </View>
      {compact ? (
        <ScrollView contentContainerStyle={styles.columns}>{columnList}</ScrollView>
      ) : (
        <ScrollView horizontal={true} contentContainerStyle={styles.columns}>
          {columnList}
        </ScrollView>
      )}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}
