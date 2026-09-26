import { beforeEach, describe, expect, it } from "vitest";
import { migrateSidebarOrderState, useSidebarOrderStore } from "./sidebar-order-store";

describe("migrateSidebarOrderState", () => {
  it("prefixes legacy per-server workspace order with the source server id", () => {
    const migrated = migrateSidebarOrderState(
      {
        projectOrderByServerId: {
          "host-a": ["project-a"],
          "host-b": ["project-a"],
        },
        workspaceOrderByServerAndProject: {
          "host-a::project-a": ["main", "feature"],
          "host-b::project-a": ["main"],
        },
      },
      2,
    );

    expect(migrated).toEqual({
      projectOrder: [],
      pinnedWorkspaceOrder: [],
      workspaceOrderByProject: {
        "project-a": ["host-a:main", "host-a:feature", "host-b:main"],
      },
      pinnedAtByConversationKey: {},
    });
  });

  it("drops auto-persisted workspace order from before recency sorting", () => {
    const migrated = migrateSidebarOrderState(
      {
        workspaceOrderByProject: {
          "project-a": ["host-a:main", "host-a:feature"],
        },
      },
      1,
    );

    expect(migrated.workspaceOrderByProject).toEqual({});
  });

  it("keeps manual project order saved after addition-time sorting", () => {
    const migrated = migrateSidebarOrderState(
      { projectOrder: [" project-b ", "project-a", "project-b"] },
      3,
    );

    expect(migrated.projectOrder).toEqual(["project-b", "project-a"]);
  });

  it("normalizes pinned workspace order", () => {
    const migrated = migrateSidebarOrderState({
      pinnedWorkspaceOrder: [" host-a:one ", "host-a:one", "", "host-b:two"],
    });

    expect(migrated.pinnedWorkspaceOrder).toEqual(["host-a:one", "host-b:two"]);
  });

  it("keeps conversation pins", () => {
    const migrated = migrateSidebarOrderState({
      pinnedAtByConversationKey: {
        " host-a:one ": " 2026-01-01T00:00:00Z ",
        "": "2026-01-01T00:00:00Z",
      },
    });
    expect(migrated.pinnedAtByConversationKey).toEqual({
      "host-a:one": "2026-01-01T00:00:00Z",
    });
  });
});

// A directory whose name ends in a space produces a view key that ends in a
// space. Trimming it on write used to make the sidebar's reconcile effect loop
// forever, crashing the app with React error #185 (see #4880).
describe("sidebar order keys that end in whitespace", () => {
  const PROJECT_KEY = "host:srv-1:/home/u/Reklamation ";

  beforeEach(() => {
    useSidebarOrderStore.setState({
      projectOrder: [],
      pinnedWorkspaceOrder: [],
      workspaceOrderByProject: {},
    });
  });

  it("stores a project key exactly as given", () => {
    useSidebarOrderStore.getState().setProjectOrder([PROJECT_KEY]);

    expect(useSidebarOrderStore.getState().projectOrder).toEqual([PROJECT_KEY]);
  });

  it("scopes a workspace order under the project key the sidebar indexes by", () => {
    useSidebarOrderStore.getState().setWorkspaceOrder(PROJECT_KEY, ["srv-1:main"]);

    // use-sidebar-workspaces-list reads workspaceOrderByProject by view key
    // directly, so the scope has to be stored under that same key.
    expect(useSidebarOrderStore.getState().workspaceOrderByProject[PROJECT_KEY]).toEqual([
      "srv-1:main",
    ]);
    expect(useSidebarOrderStore.getState().getWorkspaceOrder(PROJECT_KEY)).toEqual(["srv-1:main"]);
  });

  it("still trims keys when migrating persisted state", () => {
    const migrated = migrateSidebarOrderState(
      {
        projectOrder: [" host-a:one ", "host-a:one"],
      },
      3,
    );

    expect(migrated.projectOrder).toEqual(["host-a:one"]);
  });
});
