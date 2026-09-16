import { PARENT_AGENT_ID_LABEL } from "@getpaseo/protocol/agent-labels";

export interface CreateAgentCaller {
  id: string;
  cwd: string;
  workspaceId?: string;
}

export interface CreateAgentPlacement {
  workspaceId: string;
  cwd: string;
}

export type CreateAgentIntent = {
  cwd: string;
  parentAgentId: string | null;
  labels: Record<string, string>;
} & ({ kind: "workspace"; workspaceId: string } | { kind: "standalone" });

export async function resolveCreateAgentIntent(input: {
  explicitWorkspaceId?: string;
  placement?: { kind: "standalone"; cwd: string };
  caller: CreateAgentCaller | null;
  labels?: Record<string, string>;
  childAgentDefaultLabels?: Record<string, string>;
  resolveWorkspace: (workspaceId: string) => Promise<CreateAgentPlacement>;
  createWorkspace: () => Promise<CreateAgentPlacement>;
  legacyDetached?: boolean;
}): Promise<CreateAgentIntent> {
  const parentAgentId = input.legacyDetached ? null : (input.caller?.id ?? null);
  const placement = await resolvePlacement(input);
  const labels = {
    ...input.childAgentDefaultLabels,
    ...input.labels,
    ...(parentAgentId ? { [PARENT_AGENT_ID_LABEL]: parentAgentId } : {}),
  };

  // COMPAT(detachedCreate): legacy callers may still request detached creation.
  // Added in v0.2.0; remove after 2027-01-17 once detached creation is outside the floor.
  // The delete also strips a parent label injected through input.labels.
  if (input.legacyDetached) {
    delete labels[PARENT_AGENT_ID_LABEL];
  }

  return { ...placement, parentAgentId, labels };
}

async function resolvePlacement(input: {
  explicitWorkspaceId?: string;
  placement?: { kind: "standalone"; cwd: string };
  caller: CreateAgentCaller | null;
  resolveWorkspace: (workspaceId: string) => Promise<CreateAgentPlacement>;
  createWorkspace: () => Promise<CreateAgentPlacement>;
}): Promise<({ kind: "workspace" } & CreateAgentPlacement) | { kind: "standalone"; cwd: string }> {
  if (input.placement?.kind === "standalone") {
    if (input.explicitWorkspaceId) {
      throw new Error("Standalone agent creation cannot include workspaceId");
    }
    if (input.caller) {
      throw new Error("Subagents must belong to a workspace");
    }
    return { kind: "standalone", cwd: input.placement.cwd };
  }
  if (input.explicitWorkspaceId) {
    return { kind: "workspace", ...(await input.resolveWorkspace(input.explicitWorkspaceId)) };
  }
  if (input.caller) {
    if (!input.caller.workspaceId) {
      throw new Error(`Caller agent ${input.caller.id} has no workspace`);
    }
    return { kind: "workspace", workspaceId: input.caller.workspaceId, cwd: input.caller.cwd };
  }
  return { kind: "workspace", ...(await input.createWorkspace()) };
}
