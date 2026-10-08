import type { CheckoutPrMergeMethod } from "@getpaseo/protocol/messages";
import { create } from "zustand";
import { queryClient as appQueryClient } from "@/data/query-client";
import { useSessionStore } from "@/stores/session-store";
import { invalidateCheckoutGitQueriesForClient } from "@/git/query-keys";
import { i18n } from "@/i18n/i18next";

const SUCCESS_DISPLAY_MS = 1000;

export type CheckoutGitActionStatus = "idle" | "pending" | "success";

export type CheckoutGitAsyncActionId =
  | "commit"
  | "pull"
  | "push"
  | "pull-and-push"
  | "refresh"
  | "create-pr"
  | "commit-and-create-pr"
  | "commit-and-push"
  | "merge-pr-squash"
  | "merge-pr-merge"
  | "merge-pr-rebase"
  | "enable-pr-auto-merge-squash"
  | "enable-pr-auto-merge-merge"
  | "enable-pr-auto-merge-rebase"
  | "disable-pr-auto-merge"
  | "merge-branch"
  | "merge-from-base"
  | "discard-changes";

type CheckoutKey = string;
type StatusMap = Partial<Record<CheckoutGitAsyncActionId, CheckoutGitActionStatus>>;

export interface CheckoutCommitInput {
  serverId: string;
  cwd: string;
  message?: string;
  noVerify?: boolean;
  addAll?: boolean;
}

export class CommitFollowUpError extends Error {
  constructor(
    readonly action: "push" | "create-pr",
    cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = "CommitFollowUpError";
  }
}

function isCompositeCommit(actionId: CheckoutGitAsyncActionId): boolean {
  return actionId === "commit-and-push" || actionId === "commit-and-create-pr";
}

function checkoutKey(serverId: string, cwd: string): CheckoutKey {
  return `${serverId}::${cwd}`;
}

function resolveClient(serverId: string) {
  const session = useSessionStore.getState().sessions[serverId];
  const client = session?.client ?? null;
  if (!client) {
    throw new Error(i18n.t("common.errors.daemonClientUnavailable"));
  }
  return client;
}

type AutoMergeActionsRpc = "forge" | "github";

function resolveAutoMergeActionsRpc(serverId: string): AutoMergeActionsRpc {
  const session = useSessionStore.getState().sessions[serverId];
  if (session?.serverInfo?.features?.checkoutForgeSetAutoMerge === true) {
    return "forge";
  }
  // COMPAT(githubAutoMergeRpc): use the legacy GitHub RPC with daemons that
  // predate checkout.forge.set_auto_merge.*. Remove after 2027-01-17 once the
  // supported daemon floor is >= v0.2.0.
  if (session?.serverInfo?.features?.checkoutGithubSetAutoMerge === true) {
    return "github";
  }
  throw new Error("Update the host to use auto-merge actions.");
}

function setStatus(
  key: CheckoutKey,
  actionId: CheckoutGitAsyncActionId,
  status: CheckoutGitActionStatus,
) {
  useCheckoutGitActionsStore.setState((state) => {
    const current = state.statusByCheckout[key]?.[actionId] ?? "idle";
    if (current === status) {
      return state;
    }
    return {
      ...state,
      statusByCheckout: {
        ...state.statusByCheckout,
        [key]: {
          ...state.statusByCheckout[key],
          [actionId]: status,
        },
      },
    };
  });
}

function invalidateCheckoutGitQueries(serverId: string, cwd: string) {
  return invalidateCheckoutGitQueriesForClient(appQueryClient, { serverId, cwd });
}

const successTimers = new Map<string, ReturnType<typeof setTimeout>>();
const inFlight = new Map<string, Promise<unknown>>();

function inFlightKey(key: CheckoutKey, actionId: CheckoutGitAsyncActionId): string {
  return `${key}::${actionId}`;
}

interface CheckoutGitActionsStoreState {
  statusByCheckout: Record<CheckoutKey, StatusMap>;

  getStatus: (params: {
    serverId: string;
    cwd: string;
    actionId: CheckoutGitAsyncActionId;
  }) => CheckoutGitActionStatus;
  hasPendingAction: (params: { serverId: string; cwd: string }) => boolean;

  commit: (params: CheckoutCommitInput) => Promise<void>;
  generateCommitMessage: (params: { serverId: string; cwd: string }) => Promise<string>;
  pull: (params: { serverId: string; cwd: string }) => Promise<void>;
  push: (params: { serverId: string; cwd: string }) => Promise<void>;
  pullAndPush: (params: { serverId: string; cwd: string }) => Promise<void>;
  refresh: (params: { serverId: string; cwd: string }) => Promise<void>;
  createPr: (params: { serverId: string; cwd: string }) => Promise<void>;
  commitAndCreatePr: (params: CheckoutCommitInput) => Promise<void>;
  commitAndPush: (params: CheckoutCommitInput) => Promise<void>;
  mergePr: (params: {
    serverId: string;
    cwd: string;
    method: CheckoutPrMergeMethod;
  }) => Promise<void>;
  enablePrAutoMerge: (params: {
    serverId: string;
    cwd: string;
    method: CheckoutPrMergeMethod;
  }) => Promise<void>;
  disablePrAutoMerge: (params: { serverId: string; cwd: string }) => Promise<void>;
  mergeBranch: (params: { serverId: string; cwd: string; baseRef: string }) => Promise<void>;
  mergeFromBase: (params: { serverId: string; cwd: string; baseRef: string }) => Promise<void>;
  discardChanges: (params: { serverId: string; cwd: string; paths: string[] }) => Promise<void>;
}

async function runCheckoutAction({
  serverId,
  cwd,
  actionId,
  run,
}: {
  serverId: string;
  cwd: string;
  actionId: CheckoutGitAsyncActionId;
  run: () => Promise<void>;
}): Promise<void> {
  const key = checkoutKey(serverId, cwd);
  const inflightId = inFlightKey(key, actionId);

  const existing = inFlight.get(inflightId);
  if (existing) {
    await existing;
    return;
  }

  const statuses = useCheckoutGitActionsStore.getState().statusByCheckout[key] ?? {};
  const competingAction = Object.entries(statuses).find(
    ([id, status]) =>
      status === "pending" &&
      id !== actionId &&
      (isCompositeCommit(actionId) || id === "commit-and-push" || id === "commit-and-create-pr"),
  );
  if (competingAction) throw new Error(i18n.t("common.errors.gitActionInProgress"));

  const prevTimer = successTimers.get(inflightId);
  if (prevTimer) {
    clearTimeout(prevTimer);
    successTimers.delete(inflightId);
  }

  setStatus(key, actionId, "pending");

  const promise = (async () => {
    try {
      await run();
      await invalidateCheckoutGitQueries(serverId, cwd);
      setStatus(key, actionId, "success");
      const timer = setTimeout(() => {
        setStatus(key, actionId, "idle");
        successTimers.delete(inflightId);
      }, SUCCESS_DISPLAY_MS);
      successTimers.set(inflightId, timer);
    } catch (error) {
      setStatus(key, actionId, "idle");
      throw error;
    } finally {
      inFlight.delete(inflightId);
    }
  })();

  inFlight.set(inflightId, promise);
  await promise;
}

export const useCheckoutGitActionsStore = create<CheckoutGitActionsStoreState>()((set, get) => ({
  statusByCheckout: {},
  hasPendingAction: ({ serverId, cwd }) =>
    Object.values(get().statusByCheckout[checkoutKey(serverId, cwd)] ?? {}).includes("pending"),

  getStatus: ({ serverId, cwd, actionId }) => {
    const key = checkoutKey(serverId, cwd);
    return get().statusByCheckout[key]?.[actionId] ?? "idle";
  },

  commit: async ({ serverId, cwd, message, noVerify, addAll = true }) => {
    await runCheckoutAction({
      serverId,
      cwd,
      actionId: "commit",
      run: async () => {
        const client = resolveClient(serverId);
        const payload = await client.checkoutCommit(cwd, { addAll, message, noVerify });
        if (payload.error) {
          throw new Error(payload.error.message);
        }
      },
    });
  },

  generateCommitMessage: async ({ serverId, cwd }) => {
    const client = resolveClient(serverId);
    const payload = await client.checkoutGitGenerateCommitMessage(cwd);
    if (!payload.success || !payload.message) {
      throw new Error(
        payload.error?.message ?? i18n.t("workspace.git.actions.commit.generateFailed"),
      );
    }
    return payload.message;
  },

  pull: async ({ serverId, cwd }) => {
    await runCheckoutAction({
      serverId,
      cwd,
      actionId: "pull",
      run: async () => {
        const client = resolveClient(serverId);
        const payload = await client.checkoutPull(cwd);
        if (payload.error) {
          throw new Error(payload.error.message);
        }
      },
    });
  },

  push: async ({ serverId, cwd }) => {
    await runCheckoutAction({
      serverId,
      cwd,
      actionId: "push",
      run: async () => {
        const client = resolveClient(serverId);
        const payload = await client.checkoutPush(cwd);
        if (payload.error) {
          throw new Error(payload.error.message);
        }
      },
    });
  },

  refresh: async ({ serverId, cwd }) => {
    await runCheckoutAction({
      serverId,
      cwd,
      actionId: "refresh",
      run: async () => {
        const client = resolveClient(serverId);
        const payload = await client.checkoutRefresh(cwd);
        if (payload.error) {
          throw new Error(payload.error.message);
        }
      },
    });
  },

  pullAndPush: async ({ serverId, cwd }) => {
    await runCheckoutAction({
      serverId,
      cwd,
      actionId: "pull-and-push",
      run: async () => {
        const client = resolveClient(serverId);
        const pullPayload = await client.checkoutPull(cwd);
        if (pullPayload.error) {
          throw new Error(pullPayload.error.message);
        }
        const pushPayload = await client.checkoutPush(cwd);
        if (pushPayload.error) {
          throw new Error(pushPayload.error.message);
        }
      },
    });
  },

  commitAndPush: async ({ serverId, cwd, message, noVerify, addAll = true }) => {
    await runCheckoutAction({
      serverId,
      cwd,
      actionId: "commit-and-push",
      run: async () => {
        const client = resolveClient(serverId);
        const commitPayload = await client.checkoutCommit(cwd, { addAll, message, noVerify });
        if (commitPayload.error) {
          throw new Error(commitPayload.error.message);
        }
        try {
          const pushPayload = await client.checkoutPush(cwd);
          if (pushPayload.error) throw new Error(pushPayload.error.message);
        } catch (error) {
          throw new CommitFollowUpError("push", error);
        } finally {
          await invalidateCheckoutGitQueries(serverId, cwd).catch(() => undefined);
        }
      },
    });
  },

  createPr: async ({ serverId, cwd }) => {
    await runCheckoutAction({
      serverId,
      cwd,
      actionId: "create-pr",
      run: async () => {
        const client = resolveClient(serverId);
        const payload = await client.checkoutPrCreate(cwd, {});
        if (payload.error) {
          throw new Error(payload.error.message);
        }
      },
    });
  },

  commitAndCreatePr: async ({ serverId, cwd, message, noVerify, addAll = true }) => {
    await runCheckoutAction({
      serverId,
      cwd,
      actionId: "commit-and-create-pr",
      run: async () => {
        const client = resolveClient(serverId);
        const commitPayload = await client.checkoutCommit(cwd, { addAll, message, noVerify });
        if (commitPayload.error) {
          throw new Error(commitPayload.error.message);
        }
        try {
          const prPayload = await client.checkoutPrCreate(cwd, {});
          if (prPayload.error) {
            throw new Error(prPayload.error.message);
          }
        } catch (error) {
          throw new CommitFollowUpError("create-pr", error);
        } finally {
          // The commit already landed here, so refresh regardless of how PR creation
          // went so a failure can't leave the diff/status views showing pre-commit
          // state. Best effort: a refetch failure must not mask the error above or
          // block PR creation, which already ran.
          await invalidateCheckoutGitQueries(serverId, cwd).catch(() => undefined);
        }
      },
    });
  },

  mergePr: async ({ serverId, cwd, method }) => {
    await runCheckoutAction({
      serverId,
      cwd,
      actionId: `merge-pr-${method}`,
      run: async () => {
        const client = resolveClient(serverId);
        const payload = await client.checkoutPrMerge(cwd, { method });
        if (payload.error) {
          throw new Error(payload.error.message);
        }
      },
    });
  },

  enablePrAutoMerge: async ({ serverId, cwd, method }) => {
    const rpc = resolveAutoMergeActionsRpc(serverId);
    await runCheckoutAction({
      serverId,
      cwd,
      actionId: `enable-pr-auto-merge-${method}`,
      run: async () => {
        const client = resolveClient(serverId);
        // COMPAT(githubAutoMergeRpc): use the legacy GitHub RPC with daemons
        // that predate checkout.forge.set_auto_merge.*. Remove after 2027-01-17
        // once the supported daemon floor is >= v0.2.0.
        const payload =
          rpc === "forge"
            ? await client.checkoutForgeSetAutoMerge(cwd, { enabled: true, method })
            : await client.checkoutGithubSetAutoMerge(cwd, { enabled: true, method });
        if (payload.error) {
          throw new Error(payload.error.message);
        }
      },
    });
  },

  disablePrAutoMerge: async ({ serverId, cwd }) => {
    const rpc = resolveAutoMergeActionsRpc(serverId);
    await runCheckoutAction({
      serverId,
      cwd,
      actionId: "disable-pr-auto-merge",
      run: async () => {
        const client = resolveClient(serverId);
        // COMPAT(githubAutoMergeRpc): use the legacy GitHub RPC with daemons
        // that predate checkout.forge.set_auto_merge.*. Remove after 2027-01-17
        // once the supported daemon floor is >= v0.2.0.
        const payload =
          rpc === "forge"
            ? await client.checkoutForgeSetAutoMerge(cwd, { enabled: false })
            : await client.checkoutGithubSetAutoMerge(cwd, { enabled: false });
        if (payload.error) {
          throw new Error(payload.error.message);
        }
      },
    });
  },

  mergeBranch: async ({ serverId, cwd, baseRef }) => {
    await runCheckoutAction({
      serverId,
      cwd,
      actionId: "merge-branch",
      run: async () => {
        const client = resolveClient(serverId);
        const payload = await client.checkoutMerge(cwd, {
          baseRef,
          strategy: "merge",
          requireCleanTarget: true,
        });
        if (payload.error) {
          throw new Error(payload.error.message);
        }
      },
    });
  },

  mergeFromBase: async ({ serverId, cwd, baseRef }) => {
    await runCheckoutAction({
      serverId,
      cwd,
      actionId: "merge-from-base",
      run: async () => {
        const client = resolveClient(serverId);
        const payload = await client.checkoutMergeFromBase(cwd, {
          baseRef,
          requireCleanTarget: true,
        });
        if (payload.error) {
          throw new Error(payload.error.message);
        }
      },
    });
  },

  discardChanges: async ({ serverId, cwd, paths }) => {
    await runCheckoutAction({
      serverId,
      cwd,
      actionId: "discard-changes",
      run: async () => {
        const client = resolveClient(serverId);
        const payload = await client.checkoutDiscardChanges(cwd, { paths });
        if (!payload.success) {
          throw new Error(
            payload.error?.message ?? i18n.t("workspace.fileActions.confirmRevert.failed"),
          );
        }
      },
    });
  },
}));

export function __resetCheckoutGitActionsStoreForTests() {
  for (const timer of successTimers.values()) {
    clearTimeout(timer);
  }
  successTimers.clear();
  inFlight.clear();
  useCheckoutGitActionsStore.setState({ statusByCheckout: {} });
}
