import type { PluginClientContext, PluginSurfaceProps } from "@getpaseo/plugin/client";
import { Icon, Modal } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, Text, View, type ViewStyle } from "react-native";
import type { TasksStrings } from "../shared/strings";

type HostPaseoApi = PluginClientContext["paseo"];
type HostTheme = PluginSurfaceProps["theme"];

export interface ProviderSelection {
  provider: string;
  model: string;
}

interface PickerStyles {
  trigger: ViewStyle;
  triggerText: { color: string; fontSize: number; flex: number };
  triggerChevron: { color: string; fontSize: number };
  row: ViewStyle;
  rowText: { color: string; fontSize: number; flex: number };
  rowChevron: { color: string; fontSize: number };
  rowSelectedText: { color: string; fontSize: number; flex: number };
  sectionLabel: { color: string; fontSize: number; fontWeight: "600" };
  detail: { color: string; fontSize: number };
  list: ViewStyle;
}

function BrowserRow({
  label,
  selected,
  styles,
  onSelect,
  id,
}: {
  label: string;
  selected: boolean;
  styles: PickerStyles;
  onSelect: (id: string) => void;
  id: string;
}) {
  const handlePress = useCallback(() => onSelect(id), [onSelect, id]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={selected ? SELECTED_ROW : UNSELECTED_ROW}
      style={styles.row}
      onPress={handlePress}
    >
      <Text style={selected ? styles.rowSelectedText : styles.rowText}>{label}</Text>
      <Text style={styles.rowChevron}>›</Text>
    </Pressable>
  );
}

const SELECTED_ROW = { selected: true };
const UNSELECTED_ROW = { selected: false };

// Trigger + modal browser, mirroring the composer model selector: one compact
// row shows the current "provider / model" and opens a two-level browser
// (providers, then models). The parent owns the selection; the daemon catalog
// supplies entries and the first of each auto-selects once loaded.
export function ProviderPicker({
  paseo,
  theme,
  strings,
  selection,
  onSelection,
}: {
  paseo: HostPaseoApi;
  theme: HostTheme;
  strings: TasksStrings;
  selection: ProviderSelection | null;
  onSelection: (selection: ProviderSelection) => void;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"providers" | "models">("providers");

  const availableQuery = useQuery({
    queryKey: ["todos-providers"],
    queryFn: () => paseo.providers.listAvailable(),
  });
  const providers = useMemo(() => {
    const entries = availableQuery.data?.providers ?? [];
    return entries.filter((entry) => entry.available).map((entry) => entry.provider);
  }, [availableQuery.data]);

  useEffect(() => {
    if (providers.length === 0) return;
    if (!selection || !providers.includes(selection.provider)) {
      const first = providers[0];
      if (first) onSelection({ provider: first, model: "" });
    }
  }, [providers, selection, onSelection]);

  const modelsQuery = useQuery({
    queryKey: ["todos-models", selection?.provider ?? ""],
    queryFn: () => paseo.providers.listModels(selection?.provider ?? ""),
    enabled: !!selection?.provider,
  });
  const models = useMemo(() => modelsQuery.data?.models ?? [], [modelsQuery.data]);

  useEffect(() => {
    if (!selection?.provider || selection.model || models.length === 0) return;
    const first = models[0];
    if (first) onSelection({ provider: selection.provider, model: first.id });
  }, [models, selection, onSelection]);

  const handleOpen = useCallback(() => {
    setView("providers");
    setOpen(true);
  }, []);
  const handleClose = useCallback((next: boolean) => {
    if (!next) setView("providers");
    setOpen(next);
  }, []);
  const handleSelectProvider = useCallback(
    (provider: string) => {
      onSelection({ provider, model: "" });
      setView("models");
    },
    [onSelection],
  );
  const handleSelectModel = useCallback(
    (model: string) => {
      if (selection) onSelection({ provider: selection.provider, model });
      setOpen(false);
      setView("providers");
    },
    [onSelection, selection],
  );
  const handleBack = useCallback(() => setView("providers"), []);

  const styles = useMemo<PickerStyles>(
    () => ({
      trigger: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        padding: 10,
        borderRadius: 8,
        backgroundColor: theme.colors.surface0,
        borderWidth: 1,
        borderColor: theme.colors.border,
      },
      triggerText: { color: theme.colors.foreground, fontSize: 14, flex: 1 },
      triggerChevron: { color: theme.colors.foregroundMuted, fontSize: 16 },
      row: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingVertical: 12,
      },
      rowText: { color: theme.colors.foreground, fontSize: 15, flex: 1 },
      rowChevron: { color: theme.colors.foregroundMuted, fontSize: 18 },
      rowSelectedText: { color: theme.colors.accent, fontSize: 15, flex: 1 },
      sectionLabel: {
        color: theme.colors.foregroundMuted,
        fontSize: 13,
        fontWeight: "600",
      },
      detail: { color: theme.colors.foregroundMuted, fontSize: 13 },
      list: { gap: 4 },
    }),
    [theme],
  );

  const modalIcon = useMemo(() => <Icon name="Bot" size={18} />, []);
  const triggerLabel =
    selection?.provider && selection.model
      ? `${selection.provider} / ${selection.model}`
      : (selection?.provider ?? strings.loadingCatalog);
  const error = availableQuery.error ?? modelsQuery.error;

  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={strings.selectModel}
        style={styles.trigger}
        onPress={handleOpen}
      >
        <Icon name="Bot" size={18} />
        <Text style={styles.triggerText} numberOfLines={1}>
          {triggerLabel}
        </Text>
        <Text style={styles.triggerChevron}>›</Text>
      </Pressable>
      <Modal title={strings.selectModel} icon={modalIcon} open={open} onOpenChange={handleClose}>
        <Modal.Content>
          <View style={styles.list}>
            {view === "providers" ? (
              <View style={styles.list}>
                <Text style={styles.sectionLabel}>{strings.providerLabel}</Text>
                {availableQuery.isPending ? (
                  <Text style={styles.detail}>{strings.loadingCatalog}</Text>
                ) : null}
                {providers.length === 0 && !availableQuery.isPending ? (
                  <Text style={styles.detail}>{strings.noProviders}</Text>
                ) : null}
                {providers.map((provider) => (
                  <BrowserRow
                    key={provider}
                    id={provider}
                    label={provider}
                    selected={selection?.provider === provider}
                    styles={styles}
                    onSelect={handleSelectProvider}
                  />
                ))}
              </View>
            ) : (
              <View style={styles.list}>
                <BrowserRow
                  id="__back"
                  label={`‹ ${strings.backToProviders}`}
                  selected={false}
                  styles={styles}
                  onSelect={handleBack}
                />
                <Text style={styles.sectionLabel}>
                  {selection?.provider} · {strings.modelLabel}
                </Text>
                {models.length === 0 && !modelsQuery.isPending ? (
                  <Text style={styles.detail}>{strings.noModels}</Text>
                ) : null}
                {models.map((model) => (
                  <BrowserRow
                    key={model.id}
                    id={model.id}
                    label={model.label || model.id}
                    selected={selection?.model === model.id}
                    styles={styles}
                    onSelect={handleSelectModel}
                  />
                ))}
              </View>
            )}
            {error ? <Text style={styles.detail}>{error.message}</Text> : null}
          </View>
        </Modal.Content>
      </Modal>
    </View>
  );
}
