import type { PluginClientContext } from "@getpaseo/plugin/client";
import { useEffect, useMemo, useState } from "react";
import type { AgentAttentionReason, AgentLiveStatus, TasksStrings } from "../shared/strings";

type HostPaseoApi = PluginClientContext["paseo"];

export interface BoundAgentSnapshot {
  status: AgentLiveStatus;
  requiresAttention: boolean;
  attentionReason: AgentAttentionReason | null;
}

export interface AgentSnapshotSource {
  states: ReadonlyMap<string, BoundAgentSnapshot>;
  loaded: boolean;
}

interface WireAgent {
  id: string;
  status?: string | null;
  requiresAttention?: boolean | null;
  attentionReason?: string | null;
}

function toStatus(value: unknown): AgentLiveStatus {
  switch (value) {
    case "initializing":
    case "idle":
    case "running":
    case "error":
    case "closed":
      return value;
    default:
      return "unknown";
  }
}

function toReason(value: unknown): AgentAttentionReason | null {
  return value === "finished" || value === "error" || value === "permission" ? value : null;
}

function toSnapshot(agent: WireAgent): BoundAgentSnapshot {
  return {
    status: toStatus(agent.status),
    requiresAttention: agent.requiresAttention === true,
    attentionReason: toReason(agent.attentionReason),
  };
}

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

export type AgentBadgeTone = "muted" | "active" | "warn" | "danger";

export interface AgentBadge {
  text: string;
  tone: AgentBadgeTone;
}

// One line under the todo title: binding + live lifecycle. Attention always
// wins over the raw status so a stuck permission or finished turn is visible.
export function agentBadge(
  agentId: string | null,
  source: AgentSnapshotSource,
  strings: TasksStrings,
): AgentBadge {
  if (!agentId) return { text: strings.unassigned, tone: "muted" };
  const label = `${strings.agentLabel} ${shortId(agentId)}`;
  if (!source.loaded) return { text: label, tone: "muted" };
  const snapshot = source.states.get(agentId);
  if (!snapshot) return { text: `${label} · ${strings.agentGone}`, tone: "muted" };
  if (snapshot.requiresAttention && snapshot.attentionReason) {
    return {
      text: `${label} · ${strings.attentionName[snapshot.attentionReason]}`,
      tone: snapshot.attentionReason === "error" ? "danger" : "warn",
    };
  }
  switch (snapshot.status) {
    case "running":
    case "initializing":
      return { text: `${label} · ${strings.agentStateName[snapshot.status]}`, tone: "active" };
    case "error":
      return { text: `${label} · ${strings.agentStateName.error}`, tone: "danger" };
    default:
      return { text: `${label} · ${strings.agentStateName[snapshot.status]}`, tone: "muted" };
  }
}

// Seed from a one-shot list, then follow live agent_update events. Plain
// list() creates no daemon demand; subscribe() owns the live observation and
// is released with the surface.
export function useAgentSnapshots(paseo: HostPaseoApi): AgentSnapshotSource {
  const [states, setStates] = useState<ReadonlyMap<string, BoundAgentSnapshot>>(new Map());
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let stopped = false;
    let unsubscribe: (() => void) | null = null;
    const apply = (id: string, snapshot: BoundAgentSnapshot | null) => {
      if (stopped) return;
      setStates((prev) => {
        const next = new Map(prev);
        if (snapshot) next.set(id, snapshot);
        else next.delete(id);
        return next;
      });
    };
    paseo.agents
      .list()
      .then(({ entries }) => {
        if (stopped) return undefined;
        const seed = new Map<string, BoundAgentSnapshot>();
        for (const entry of entries) {
          const agent = (entry as { agent: WireAgent }).agent;
          seed.set(agent.id, toSnapshot(agent));
        }
        setStates(seed);
        setLoaded(true);
        unsubscribe = paseo.agents.subscribe((update) => {
          if (update.kind === "remove") apply(update.agentId, null);
          else apply(update.agent.id, toSnapshot(update.agent));
        });
        return undefined;
      })
      .catch((error) => {
        if (!stopped) console.error("Agent observation failed", error);
      });
    return () => {
      stopped = true;
      unsubscribe?.();
    };
  }, [paseo]);
  return useMemo(() => ({ states, loaded }), [states, loaded]);
}
