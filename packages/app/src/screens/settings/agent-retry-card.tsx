import { useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { SettingsCard, SettingsRow, SettingsSelect } from "@/components/settings";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useHostFeature } from "@/runtime/host-features";

const RETRY_OPTIONS = ["0", "1", "2", "3", "4", "5"];

export function AgentRetryCard({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  // COMPAT(agentRetry): added in v0.10.0, remove after 2027-04-01 once daemon floor >= v0.10.0.
  const supported = useHostFeature(serverId, "agentRetry");
  const { config, patchConfig } = useDaemonConfig(serverId);
  const mutation = useMutation({
    mutationFn: async (value: string) => {
      const result = await patchConfig({ agentRetryAttempts: Number(value) });
      if (!result) throw new Error(t("workspace.terminal.hostDisconnected"));
      return result;
    },
  });
  const options = useMemo(
    () =>
      RETRY_OPTIONS.map((value) => ({
        value,
        label: value === "0" ? t("settings.host.agents.retry.off") : value,
      })),
    [t],
  );

  if (!supported) {
    return (
      <SettingsCard>
        <SettingsRow
          label={t("settings.host.agents.retry.label")}
          hint={t("settings.host.agents.retry.updateHost")}
        />
      </SettingsCard>
    );
  }
  const hint = mutation.isPending
    ? t("settings.host.agents.retry.saving")
    : t("settings.host.agents.retry.hint");
  return (
    <SettingsCard testID="agent-retry-settings">
      <SettingsSelect
        label={t("settings.host.agents.retry.label")}
        hint={hint}
        value={config ? String(config.agentRetryAttempts) : ""}
        options={options}
        onValueChange={mutation.mutate}
        disabled={!config || mutation.isPending}
        error={mutation.error?.message}
      />
    </SettingsCard>
  );
}
