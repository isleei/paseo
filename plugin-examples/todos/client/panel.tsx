import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { usePaseo, useRpc, useWorkspace } from "@getpaseo/plugin/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import {
  deleteTaskRpc,
  dispatchTaskRpc,
  latestTaskRun,
  listTasksRpc,
  moveTaskRpc,
  type Task,
} from "../shared/todo";
import { STRINGS, pickLocale, type TasksLocale, type TasksStrings } from "../shared/strings";
import { agentBadge, useAgentSnapshots, type AgentSnapshotSource } from "./agent-status";
import { ProviderPicker, type ProviderSelection } from "./provider-picker";
import { getWebLanguage } from "./web";

const ENABLED_STATE = { disabled: false };
const DISABLED_STATE = { disabled: true };

interface PanelStyles {
  detail: { color: string; fontSize: number };
  error: { color: string; fontSize: number };
  card: { padding: number; borderRadius: number; gap: number; backgroundColor: string };
  cardHeader: { flexDirection: "row"; alignItems: "center"; gap: number };
  cardTitle: { color: string; fontSize: number; flex: number };
  deleteText: { color: string; fontSize: number };
  agentActive: { color: string; fontSize: number };
  agentWarn: { color: string; fontSize: number };
  agentDanger: { color: string; fontSize: number };
  button: { padding: number; borderRadius: number; backgroundColor: string };
  buttonText: { color: string; textAlign: "center"; fontSize: number };
}

function PanelTaskRow({
  task,
  styles,
  strings,
  agentSource,
  starting,
  onRun,
  onPlan,
  onDelete,
  onOpenAgent,
}: {
  task: Task;
  styles: PanelStyles;
  strings: TasksStrings;
  agentSource: AgentSnapshotSource;
  starting: boolean;
  onRun: (id: string) => void;
  onPlan: (id: string) => void;
  onDelete: (id: string) => void;
  onOpenAgent?: (agentId: string) => void;
}) {
  const latestRun = latestTaskRun(task);
  const runnable = task.status !== "done" && latestRun?.outcome !== "running";
  const plannable = task.status === "inbox";
  const runActionLabel = task.runs.length > 0 ? strings.runAgain : strings.run;
  const runButtonLabel = starting ? strings.starting : runActionLabel;
  const handleRun = useCallback(() => onRun(task.id), [onRun, task.id]);
  const handlePlan = useCallback(() => onPlan(task.id), [onPlan, task.id]);
  const handleDelete = useCallback(() => onDelete(task.id), [onDelete, task.id]);
  const handleOpenAgent = useCallback(() => {
    if (latestRun && onOpenAgent) onOpenAgent(latestRun.agentId);
  }, [latestRun, onOpenAgent]);
  const badge = useMemo(
    () => agentBadge(latestRun?.agentId ?? null, agentSource, strings),
    [agentSource, latestRun?.agentId, strings],
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

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>
          {task.title} · {strings.statusName[task.status]}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${strings.deleteAction} ${task.title}`}
          onPress={handleDelete}
        >
          <Text style={styles.deleteText}>✕</Text>
        </Pressable>
      </View>
      <Text style={badgeStyle}>{badge.text}</Text>
      <Text style={styles.detail}>
        {task.runs.length} {strings.executionCount}
      </Text>
      {latestRun?.error ? <Text style={styles.error}>{latestRun.error}</Text> : null}
      {latestRun && onOpenAgent ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${strings.openAgent} ${task.title}`}
          style={styles.button}
          onPress={handleOpenAgent}
        >
          <Text style={styles.buttonText}>{strings.openAgent}</Text>
        </Pressable>
      ) : null}
      {runnable ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${runActionLabel} ${task.title}`}
          accessibilityState={starting ? DISABLED_STATE : ENABLED_STATE}
          disabled={starting}
          style={styles.button}
          onPress={handleRun}
        >
          <Text style={styles.buttonText}>{runButtonLabel}</Text>
        </Pressable>
      ) : null}
      {plannable ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${strings.plan} ${task.title}`}
          style={styles.button}
          onPress={handlePlan}
        >
          <Text style={styles.buttonText}>{strings.plan}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function TasksPanel({ theme, layout, workspaceId, navigation }: PluginWorkspacePanelProps) {
  const paseo = usePaseo();
  const workspace = useWorkspace(workspaceId, ({ name, directory }) => ({ name, directory }));
  const listTasks = useRpc(listTasksRpc);
  const moveTask = useRpc(moveTaskRpc);
  const dispatchTask = useRpc(dispatchTaskRpc);
  const deleteTask = useRpc(deleteTaskRpc);
  const queryClient = useQueryClient();
  const [locale, setLocale] = useState<TasksLocale>(() => pickLocale(getWebLanguage()));
  const strings = STRINGS[locale];
  const agentSource = useAgentSnapshots(paseo);
  const [providerSelection, setProviderSelection] = useState<ProviderSelection | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const tasksQuery = useQuery({
    queryKey: ["tasks"],
    queryFn: () => listTasks({}),
    refetchInterval: 3_000,
  });
  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["tasks"] });
  }, [queryClient]);
  const moveMutation = useMutation({ mutationFn: moveTask, onSuccess: invalidate });
  const dispatchMutation = useMutation({
    mutationFn: dispatchTask,
    onSuccess: () => {
      setFormError(null);
      invalidate();
    },
  });
  const deleteMutation = useMutation({ mutationFn: deleteTask, onSuccess: invalidate });

  const handleRun = useCallback(
    (id: string) => {
      if (!workspace?.directory || !providerSelection?.provider || !providerSelection.model) {
        setFormError(strings.runSetupRequired);
        return;
      }
      dispatchMutation.mutate({
        id,
        cwd: workspace.directory,
        provider: providerSelection.provider,
        model: providerSelection.model,
      });
    },
    [dispatchMutation, providerSelection, strings.runSetupRequired, workspace?.directory],
  );
  const handlePlan = useCallback(
    (id: string) => moveMutation.mutate({ id, status: "planning" }),
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

  const styles = useMemo(
    () => ({
      screen: {
        flexGrow: 1,
        padding: layout.compact ? 16 : 24,
        gap: 12,
        backgroundColor: theme.colors.surface0,
      },
      titleRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
      title: { color: theme.colors.foreground, fontSize: layout.compact ? 18 : 20, flex: 1 },
      localeButton: {
        paddingVertical: 6,
        paddingHorizontal: 12,
        borderRadius: 8,
        backgroundColor: "transparent",
        borderWidth: 1,
        borderColor: theme.colors.border,
      },
      localeButtonText: {
        color: theme.colors.foreground,
        textAlign: "center" as const,
        fontSize: 13,
      },
      detail: { color: theme.colors.foregroundMuted, fontSize: 13 },
      error: { color: theme.colors.statusDanger, fontSize: 13 },
      sectionHeader: {
        color: theme.colors.foreground,
        fontSize: 14,
        fontWeight: "600" as const,
      },
      section: { gap: 8 },
      card: { padding: 12, borderRadius: 10, gap: 6, backgroundColor: theme.colors.surface1 },
      cardHeader: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
      cardTitle: { color: theme.colors.foreground, fontSize: 14, flex: 1 },
      deleteText: { color: theme.colors.statusDanger, fontSize: 14 },
      agentActive: { color: theme.colors.accent, fontSize: 13 },
      agentWarn: { color: theme.colors.statusWarning, fontSize: 13 },
      agentDanger: { color: theme.colors.statusDanger, fontSize: 13 },
      button: { padding: 10, borderRadius: 10, backgroundColor: theme.colors.accent },
      buttonText: {
        color: theme.colors.accentForeground,
        textAlign: "center" as const,
        fontSize: 13,
      },
    }),
    [layout.compact, theme],
  );

  const rowStyles = useMemo<PanelStyles>(
    () => ({
      detail: styles.detail,
      error: styles.error,
      card: styles.card,
      cardHeader: styles.cardHeader,
      cardTitle: styles.cardTitle,
      deleteText: styles.deleteText,
      agentActive: styles.agentActive,
      agentWarn: styles.agentWarn,
      agentDanger: styles.agentDanger,
      button: styles.button,
      buttonText: styles.buttonText,
    }),
    [styles],
  );

  const allTasks = useMemo(() => tasksQuery.data?.tasks ?? [], [tasksQuery.data]);
  const tasksHere = allTasks.filter((task) => latestTaskRun(task)?.workspaceId === workspaceId);
  const inboxTasks = allTasks.filter(
    (task) => task.runs.length === 0 && (task.status === "inbox" || task.status === "planning"),
  );
  const error =
    formError ??
    tasksQuery.error?.message ??
    moveMutation.error?.message ??
    dispatchMutation.error?.message ??
    deleteMutation.error?.message ??
    null;

  const renderRow = useCallback(
    (task: Task) => (
      <PanelTaskRow
        key={task.id}
        task={task}
        styles={rowStyles}
        strings={strings}
        agentSource={agentSource}
        starting={dispatchMutation.isPending}
        onRun={handleRun}
        onPlan={handlePlan}
        onDelete={handleDelete}
        onOpenAgent={navigation ? handleOpenAgent : undefined}
      />
    ),
    [
      agentSource,
      dispatchMutation.isPending,
      handleDelete,
      handleOpenAgent,
      handlePlan,
      handleRun,
      navigation,
      rowStyles,
      strings,
    ],
  );

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>{strings.boardTitle}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={strings.switchLanguageLabel}
          style={styles.localeButton}
          onPress={handleToggleLocale}
        >
          <Text style={styles.localeButtonText}>{strings.switchLanguageLabel}</Text>
        </Pressable>
      </View>
      <Text style={styles.detail}>{workspace?.name ?? workspaceId}</Text>
      <ProviderPicker
        paseo={paseo}
        theme={theme}
        strings={strings}
        selection={providerSelection}
        onSelection={setProviderSelection}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.section}>
        <Text style={styles.sectionHeader}>
          {strings.thisWorkspace} · {tasksHere.length}
        </Text>
        {tasksHere.length === 0 ? <Text style={styles.detail}>{strings.nothingHere}</Text> : null}
        {tasksHere.map(renderRow)}
      </View>
      <View style={styles.section}>
        <Text style={styles.sectionHeader}>
          {strings.inboxSection} · {inboxTasks.length}
        </Text>
        {inboxTasks.length === 0 ? <Text style={styles.detail}>{strings.empty}</Text> : null}
        {inboxTasks.map(renderRow)}
      </View>
    </ScrollView>
  );
}
