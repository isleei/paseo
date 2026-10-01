import { useCallback, useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { AgentRetryState } from "@getpaseo/protocol/messages";
import { useSessionStore } from "@/stores/session-store";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

interface RetryStatusProps {
  serverId: string;
  agentId: string;
}

export function AgentRetryStatus({ serverId, agentId }: RetryStatusProps) {
  const retry = useSessionStore((state) => {
    const session = state.sessions[serverId];
    const agent = session?.agents.get(agentId) ?? session?.agentDetails.get(agentId);
    return agent?.retry ?? null;
  });
  if (!retry) return null;
  return <RetryCountdown key={retry.retryAt} serverId={serverId} agentId={agentId} retry={retry} />;
}

function RetryCountdown({
  serverId,
  agentId,
  retry,
}: RetryStatusProps & { retry: AgentRetryState }) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const connected = useHostRuntimeIsConnected(serverId);
  const active = useRetainedPanelActive();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [active]);
  const action = useMutation({
    mutationFn: async (intent: "retry" | "cancel") => {
      if (!client) throw new Error(t("workspace.terminal.hostDisconnected"));
      if (intent === "retry") await client.retryAgentNow(agentId);
      else await client.cancelAgent(agentId);
    },
  });
  const retryNow = useCallback(() => action.mutate("retry"), [action]);
  const cancel = useCallback(() => action.mutate("cancel"), [action]);
  const seconds = Math.max(0, Math.ceil((Date.parse(retry.retryAt) - now) / 1_000));
  const disabled = !connected || action.isPending;
  return (
    <Alert
      size="sm"
      variant="warning"
      testID="agent-retry-status"
      title={t("composer.retry.waiting", {
        seconds,
        attempt: retry.attempt,
        maxAttempts: retry.maxAttempts,
      })}
      description={action.error?.message ?? retry.error}
    >
      <Button
        size="sm"
        variant="outline"
        disabled={disabled}
        loading={action.isPending && action.variables === "retry"}
        onPress={retryNow}
      >
        {t("composer.retry.now")}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={disabled}
        loading={action.isPending && action.variables === "cancel"}
        onPress={cancel}
      >
        {t("common.actions.cancel")}
      </Button>
    </Alert>
  );
}
