import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import {
  migratePersistedWorkspaceRail,
  PersistedWorkspaceRailSchema,
  toggleSectionId,
  withDefaultClosedSections,
  type PersistedWorkspaceRail,
  type RailSectionId,
} from "./rail-state";

/** v1 introduced the first default fold; see `migratePersistedWorkspaceRail`. */
const WORKSPACE_RAIL_STORE_VERSION = 1;

interface WorkspaceRailState {
  collapsed: boolean;
  closedSections: RailSectionId[];
  toggleCollapsed: () => void;
  toggleSection: (id: RailSectionId) => void;
}

/**
 * The rail's own chrome — collapsed or not, which sections are folded — persisted globally rather
 * than per workspace. A user who folds the rail wants it folded everywhere; re-folding it in each
 * of a dozen workspaces is the kind of thing that makes a panel not worth having.
 */
export const useWorkspaceRailStore = create<WorkspaceRailState>()(
  persist<WorkspaceRailState, [], [], PersistedWorkspaceRail>(
    (set) => ({
      collapsed: false,
      closedSections: withDefaultClosedSections([]),
      toggleCollapsed: () => set((state) => ({ ...state, collapsed: !state.collapsed })),
      toggleSection: (id) =>
        set((state) => ({ ...state, closedSections: toggleSectionId(state.closedSections, id) })),
    }),
    {
      name: "workspace-rail",
      version: WORKSPACE_RAIL_STORE_VERSION,
      storage: createValidatedPersistStorage(AsyncStorage, PersistedWorkspaceRailSchema),
      partialize: (state) => ({
        collapsed: state.collapsed,
        closedSections: state.closedSections,
      }),
      migrate: (persistedState) => migratePersistedWorkspaceRail(persistedState),
    },
  ),
);
