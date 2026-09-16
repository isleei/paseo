import { describe, expect, it } from "vitest";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { pickSessionActivityTarget } from "./session-activity-target";

function createAgent(overrides: Partial<AggregatedAgent> = {}): AggregatedAgent {
  return {
    id: "agent-1",
    serverId: "server-1",
    serverLabel: "Local",
    title: "Session",
    status: "idle",
    turn: { phase: "idle", cancellationRequestId: null },
    lastActivityAt: new Date("2026-09-16T10:00:00.000Z"),
    cwd: "/repo",
    workspaceId: undefined,
    provider: "codex",
    pendingPermissionCount: 0,
    requiresAttention: false,
    attentionReason: null,
    attentionTimestamp: null,
    archivedAt: null,
    createdAt: new Date("2026-09-16T09:00:00.000Z"),
    labels: {},
    projectPlacement: null,
    ...overrides,
  };
}

describe("pickSessionActivityTarget", () => {
  it("prioritizes permission and error before completed sessions", () => {
    const target = pickSessionActivityTarget([
      createAgent({
        id: "finished",
        requiresAttention: true,
        attentionReason: "finished",
        attentionTimestamp: new Date("2026-09-16T12:00:00.000Z"),
      }),
      createAgent({
        id: "error",
        requiresAttention: true,
        attentionReason: "error",
        attentionTimestamp: new Date("2026-09-16T11:00:00.000Z"),
      }),
      createAgent({ id: "permission", pendingPermissionCount: 1 }),
    ]);

    expect(target).toMatchObject({ kind: "attention", agent: { id: "permission" } });
  });

  it("selects the newest unread completion at the same priority", () => {
    const target = pickSessionActivityTarget([
      createAgent({
        id: "older",
        requiresAttention: true,
        attentionReason: "finished",
        attentionTimestamp: new Date("2026-09-16T10:00:00.000Z"),
      }),
      createAgent({
        id: "newer",
        requiresAttention: true,
        attentionReason: "finished",
        attentionTimestamp: new Date("2026-09-16T12:00:00.000Z"),
      }),
    ]);

    expect(target).toMatchObject({ kind: "attention", agent: { id: "newer" } });
  });

  it("falls back to the most recently active running session", () => {
    const target = pickSessionActivityTarget([
      createAgent({
        id: "older-running",
        status: "running",
        lastActivityAt: new Date("2026-09-16T10:00:00.000Z"),
      }),
      createAgent({
        id: "newer-running",
        status: "running",
        lastActivityAt: new Date("2026-09-16T12:00:00.000Z"),
      }),
    ]);

    expect(target).toMatchObject({ kind: "running", agent: { id: "newer-running" } });
  });

  it("ignores archived sessions and returns null when nothing is active", () => {
    expect(
      pickSessionActivityTarget([
        createAgent({
          status: "running",
          archivedAt: new Date("2026-09-16T12:00:00.000Z"),
        }),
      ]),
    ).toBeNull();
  });
});
