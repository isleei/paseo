import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

interface SidebarOrderStoreState {
  projectOrder: string[];
  pinnedWorkspaceOrder: string[];
  workspaceOrderByProject: Record<string, string[]>;
  pinnedAtByConversationKey: Record<string, string>;
  getProjectOrder: () => string[];
  setProjectOrder: (keys: string[]) => void;
  getPinnedWorkspaceOrder: () => string[];
  setPinnedWorkspaceOrder: (keys: string[]) => void;
  getWorkspaceOrder: (projectViewKey: string) => string[];
  setWorkspaceOrder: (projectViewKey: string, keys: string[]) => void;
  setConversationPinned: (workspaceKey: string, pinnedAt: string | null) => void;
}

interface SidebarOrderPersistedState {
  projectOrder?: string[];
  pinnedWorkspaceOrder?: string[];
  workspaceOrderByProject?: Record<string, string[]>;
  pinnedAtByConversationKey?: Record<string, string>;
  projectOrderByServerId?: Record<string, string[]>;
  workspaceOrderByServerAndProject?: Record<string, string[]>;
}

const StringArrayRecordSchema = z.record(z.string(), z.array(z.string()));
const SidebarOrderPersistedStateSchema = z.strictObject({
  projectOrder: z.array(z.string()).optional(),
  pinnedWorkspaceOrder: z.array(z.string()).optional(),
  workspaceOrderByProject: StringArrayRecordSchema.optional(),
  pinnedAtByConversationKey: z.record(z.string(), z.string()).optional(),
  projectOrderByServerId: StringArrayRecordSchema.optional(),
  workspaceOrderByServerAndProject: StringArrayRecordSchema.optional(),
});

interface SidebarWorkspaceOrderScope {
  serverId: string;
  projectViewKey: string;
}

// Trims each key. Only for persisted state read at migration time, where a
// stray space is an artifact of an older format rather than part of the key.
function normalizeKeys(keys: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const rawKey of keys) {
    const key = rawKey.trim();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push(key);
  }

  return normalized;
}

/**
 * Drops blank keys and duplicates but keeps each key exactly as given. View
 * keys embed a project's path, so a directory whose name ends in a space
 * produces a key that ends in a space. Trimming it stores a key that can never
 * match the one the sidebar looks up, so the caller sees its key as missing,
 * writes it again, and the effect that reconciles the order never settles.
 */
function dedupeKeys(keys: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const key of keys) {
    if (!key.trim() || seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(key);
  }

  return deduped;
}

function normalizeWorkspaceOrderByProject(
  workspaceOrderByProject: Record<string, string[]> | undefined,
): Record<string, string[]> {
  const normalized: Record<string, string[]> = {};
  for (const [projectViewKey, order] of Object.entries(workspaceOrderByProject ?? {})) {
    const scope = projectViewKey.trim();
    if (!scope) continue;
    normalized[scope] = normalizeKeys(order);
  }
  return normalized;
}

function extractWorkspaceOrderScope(scopeKey: string): SidebarWorkspaceOrderScope | null {
  const separatorIndex = scopeKey.indexOf("::");
  if (separatorIndex < 0) return null;
  const serverId = scopeKey.slice(0, separatorIndex).trim();
  const projectViewKey = scopeKey.slice(separatorIndex + 2).trim();
  if (!serverId || !projectViewKey) return null;
  return { serverId, projectViewKey };
}

function normalizeLegacyWorkspaceKey(serverId: string, rawWorkspaceKey: string): string | null {
  const workspaceKey = rawWorkspaceKey.trim();
  if (!workspaceKey) return null;
  const serverPrefix = `${serverId}:`;
  return workspaceKey.startsWith(serverPrefix) ? workspaceKey : `${serverPrefix}${workspaceKey}`;
}

function normalizePinnedAtByConversationKey(
  pinnedAtByConversationKey: Record<string, string> | undefined,
): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(pinnedAtByConversationKey ?? {})) {
    const key = rawKey.trim();
    const value = rawValue.trim();
    if (!key || !value) continue;
    normalized[key] = value;
  }
  return normalized;
}

export function migrateSidebarOrderState(
  persistedState: unknown,
  fromVersion = 0,
): {
  projectOrder: string[];
  pinnedWorkspaceOrder: string[];
  workspaceOrderByProject: Record<string, string[]>;
  pinnedAtByConversationKey: Record<string, string>;
} {
  const result = SidebarOrderPersistedStateSchema.safeParse(persistedState);
  if (!result.success) {
    return {
      projectOrder: [],
      pinnedWorkspaceOrder: [],
      workspaceOrderByProject: {},
      pinnedAtByConversationKey: {},
    };
  }
  const state: SidebarOrderPersistedState = result.data;

  const projectOrder = normalizeKeys(state.projectOrder ?? []);
  const seenProjects = new Set(projectOrder);
  for (const keys of Object.values(state.projectOrderByServerId ?? {})) {
    for (const key of normalizeKeys(keys)) {
      if (seenProjects.has(key)) continue;
      seenProjects.add(key);
      projectOrder.push(key);
    }
  }

  const workspaceOrderByProject = normalizeWorkspaceOrderByProject(state.workspaceOrderByProject);
  for (const [scopeKey, order] of Object.entries(state.workspaceOrderByServerAndProject ?? {})) {
    const scope = extractWorkspaceOrderScope(scopeKey);
    if (!scope) continue;
    const existing = workspaceOrderByProject[scope.projectViewKey] ?? [];
    const merged = [...existing];
    const seen = new Set(merged);
    for (const key of order) {
      const workspaceKey = normalizeLegacyWorkspaceKey(scope.serverId, key);
      if (!workspaceKey || seen.has(workspaceKey)) continue;
      seen.add(workspaceKey);
      merged.push(workspaceKey);
    }
    workspaceOrderByProject[scope.projectViewKey] = merged;
  }

  return {
    // Before v3, merely viewing projects persisted their first-seen order. It cannot
    // be distinguished from a drag, so reset it once to enable addition-time sorting.
    projectOrder: fromVersion < 3 ? [] : projectOrder,
    pinnedWorkspaceOrder: normalizeKeys(state.pinnedWorkspaceOrder ?? []),
    // v1 auto-wrote first-seen (alphabetical) workspace order. Recency is live,
    // so drop that freeze; drag still writes workspaceOrderByProject after v2.
    workspaceOrderByProject: fromVersion < 2 ? {} : workspaceOrderByProject,
    pinnedAtByConversationKey: normalizePinnedAtByConversationKey(state.pinnedAtByConversationKey),
  };
}

export const useSidebarOrderStore = create<SidebarOrderStoreState>()(
  persist(
    (set, get) => ({
      projectOrder: [],
      pinnedWorkspaceOrder: [],
      workspaceOrderByProject: {},
      pinnedAtByConversationKey: {},
      getProjectOrder: () => get().projectOrder,
      setProjectOrder: (keys) => {
        set({ projectOrder: dedupeKeys(keys) });
      },
      getPinnedWorkspaceOrder: () => get().pinnedWorkspaceOrder,
      setPinnedWorkspaceOrder: (keys) => {
        set({ pinnedWorkspaceOrder: dedupeKeys(keys) });
      },
      getWorkspaceOrder: (projectViewKey) => {
        if (!projectViewKey.trim()) return [];
        return get().workspaceOrderByProject[projectViewKey] ?? [];
      },
      setWorkspaceOrder: (projectViewKey, keys) => {
        if (!projectViewKey.trim()) return;
        set((state) => ({
          workspaceOrderByProject: {
            ...state.workspaceOrderByProject,
            [projectViewKey]: dedupeKeys(keys),
          },
        }));
      },
      setConversationPinned: (workspaceKey, pinnedAt) => {
        const key = workspaceKey.trim();
        if (!key) return;
        set((state) => {
          if (!pinnedAt) {
            if (!(key in state.pinnedAtByConversationKey)) {
              return state;
            }
            const next = { ...state.pinnedAtByConversationKey };
            delete next[key];
            return { pinnedAtByConversationKey: next };
          }
          const value = pinnedAt.trim();
          if (!value || state.pinnedAtByConversationKey[key] === value) {
            return state;
          }
          return {
            pinnedAtByConversationKey: {
              ...state.pinnedAtByConversationKey,
              [key]: value,
            },
          };
        });
      },
    }),
    {
      name: "sidebar-project-workspace-order",
      storage: createValidatedPersistStorage(AsyncStorage, SidebarOrderPersistedStateSchema),
      partialize: (state) => ({
        projectOrder: state.projectOrder,
        pinnedWorkspaceOrder: state.pinnedWorkspaceOrder,
        workspaceOrderByProject: state.workspaceOrderByProject,
        pinnedAtByConversationKey: state.pinnedAtByConversationKey,
      }),
      version: 3,
      migrate: migrateSidebarOrderState,
    },
  ),
);
