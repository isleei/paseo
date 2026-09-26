import { describe, expect, it, vi } from "vitest";
import type { CreationSnapshot } from "@getpaseo/protocol/messages";
import {
  createWorkspaceAgentCreation,
  retryFailedWorkspaceAgent,
  WorkspaceCreationFailure,
} from "./creation-retry";

const failedAgent: CreationSnapshot = {
  kind: "workspace",
  idempotencyKey: "draft-1",
  revision: 3,
  phase: "failed",
  workspaceId: "workspace-1",
  agentId: "reserved-agent",
  failedStage: "agent",
  outcomeUnknown: false,
  error: "Provider unavailable",
};

describe("retryFailedWorkspaceAgent", () => {
  it("creates a new agent in the ready workspace after a conclusive startup failure", async () => {
    const agent = { id: "new-agent" };
    const createAgent = vi.fn().mockResolvedValue(agent);
    const request = {
      config: { provider: "codex" as const, cwd: "/workspace" },
      initialPrompt: "Revised prompt",
    };

    await expect(
      retryFailedWorkspaceAgent({
        failure: new WorkspaceCreationFailure("Provider unavailable", failedAgent),
        createAgent,
        request,
        idempotencyKey: "retry-1",
      }),
    ).resolves.toBe(agent);
    expect(createAgent).toHaveBeenCalledWith({
      ...request,
      workspaceId: "workspace-1",
      idempotencyKey: "retry-1",
    });
  });

  it.each([
    { ...failedAgent, outcomeUnknown: true },
    { ...failedAgent, failedStage: "prompt" as const },
    { ...failedAgent, failedStage: "workspace" as const },
  ])("does not duplicate work after an uncertain or non-agent failure", async (creation) => {
    const createAgent = vi.fn();
    const failure = new WorkspaceCreationFailure("Creation failed", creation);
    await expect(
      retryFailedWorkspaceAgent({
        failure,
        createAgent,
        request: { config: { provider: "codex", cwd: "/workspace" } },
        idempotencyKey: "retry-1",
      }),
    ).rejects.toBe(failure);
    expect(createAgent).not.toHaveBeenCalled();
  });
});

describe("createWorkspaceAgentCreation", () => {
  it("joins the original agent while workspace creation is still running", async () => {
    let resolve!: (value: { id: string }) => void;
    const result = new Promise<{ id: string }>((done) => {
      resolve = done;
    });
    const createAgent = vi.fn();
    const creation = createWorkspaceAgentCreation({
      result,
      createAgent,
      nextIdempotencyKey: () => "retry-1",
    });
    const retry = creation.retry({ config: { provider: "codex", cwd: "/workspace" } });
    expect(createAgent).not.toHaveBeenCalled();
    resolve({ id: "original-agent" });
    await expect(retry).resolves.toEqual({ id: "original-agent" });
    expect(createAgent).not.toHaveBeenCalled();
  });

  it("uses a fresh agent request after the original agent conclusively fails", async () => {
    const createAgent = vi.fn().mockResolvedValue({ id: "new-agent" });
    const creation = createWorkspaceAgentCreation({
      result: Promise.reject(new WorkspaceCreationFailure("Provider unavailable", failedAgent)),
      createAgent,
      nextIdempotencyKey: () => "retry-1",
    });
    await expect(
      creation.retry({
        config: { provider: "codex", cwd: "/workspace" },
        initialPrompt: "Revised prompt",
      }),
    ).resolves.toEqual({ id: "new-agent" });
    expect(createAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: "retry-1",
        workspaceId: "workspace-1",
        initialPrompt: "Revised prompt",
      }),
    );
  });
});
