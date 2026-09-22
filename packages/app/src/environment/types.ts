import type {
  EnvironmentCheckEntry,
  EnvironmentCheckResponseMessage,
  EnvironmentUpgradeEntry,
} from "@getpaseo/protocol/messages";

export type { EnvironmentCheckEntry, EnvironmentCheckResponseMessage, EnvironmentUpgradeEntry };

export type EnvironmentCheckPayload = EnvironmentCheckResponseMessage["payload"];

export type EnvironmentView =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; payload: EnvironmentCheckPayload; isFetching: boolean };
