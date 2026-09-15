import { create } from "zustand";

export interface CommitSheetRequest {
  serverId: string;
  cwd: string;
}

interface CommitSheetStoreState {
  request: CommitSheetRequest | null;
  openCommitSheet: (request: CommitSheetRequest) => void;
  closeCommitSheet: () => void;
}

/**
 * Opens the commit sheet for a workspace. The sheet itself is mounted once at
 * the workspace screen so both the header actions and the diff pane can open
 * it without prop drilling.
 */
export const useCommitSheetStore = create<CommitSheetStoreState>()((set) => ({
  request: null,
  openCommitSheet: (request) => set({ request }),
  closeCommitSheet: () => set({ request: null }),
}));
