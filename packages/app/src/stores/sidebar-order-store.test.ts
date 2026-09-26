import { describe, expect, it } from "vitest";
import { migrateSidebarOrderState } from "./sidebar-order-store";

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
