import type { CreateAgentRequestOptions } from "@getpaseo/client/internal/daemon-client";
import type { CreationSnapshot } from "@getpaseo/protocol/messages";

export class WorkspaceCreationFailure extends Error {
  constructor(
    message: string,
    readonly creation?: CreationSnapshot,
  ) {
    super(message);
  }
}

/** A changed draft is a new agent intent after the original workspace has already been created. */
export async function retryFailedWorkspaceAgent<TAgent>(input: {
  failure: unknown;
  createAgent: (request: CreateAgentRequestOptions) => Promise<TAgent>;
  request: CreateAgentRequestOptions;
  idempotencyKey: string;
}): Promise<TAgent> {
  const creation =
    input.failure instanceof WorkspaceCreationFailure ? input.failure.creation : undefined;
  if (
    creation?.phase !== "failed" ||
    creation.failedStage !== "agent" ||
    creation.outcomeUnknown ||
    creation.agent ||
    !creation.workspaceId
  ) {
    throw input.failure;
  }
  return input.createAgent({
    ...input.request,
    workspaceId: creation.workspaceId,
    idempotencyKey: input.idempotencyKey,
  });
}

export function createWorkspaceAgentCreation<TAgent>(input: {
  result: Promise<TAgent>;
  createAgent: (request: CreateAgentRequestOptions) => Promise<TAgent>;
  nextIdempotencyKey: () => string;
}) {
  return {
    result: input.result,
    retry: async (request: CreateAgentRequestOptions): Promise<TAgent> => {
      try {
        return await input.result;
      } catch (failure) {
        return retryFailedWorkspaceAgent({
          failure,
          createAgent: input.createAgent,
          request,
          idempotencyKey: input.nextIdempotencyKey(),
        });
      }
    },
  };
}
