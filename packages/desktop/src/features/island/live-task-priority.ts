/**
 * Paseo port (verbatim): live-task priority shared by sidebar and island.
 * Lower ranks first: waiting > unread > running > rest.
 */
export const LIVE_TASK_PRIORITY = {
  waiting: 0,
  unread: 1,
  running: 2,
  rest: 3,
} as const;

export type LiveTaskPriorityRank = (typeof LIVE_TASK_PRIORITY)[keyof typeof LIVE_TASK_PRIORITY];

export interface LiveTaskPrioritySignals {
  waiting: boolean;
  unread: boolean;
  running: boolean;
}

export function liveTaskPriorityRank(signals: LiveTaskPrioritySignals): LiveTaskPriorityRank {
  if (signals.waiting) return LIVE_TASK_PRIORITY.waiting;
  if (signals.unread && !signals.running) return LIVE_TASK_PRIORITY.unread;
  if (signals.running) return LIVE_TASK_PRIORITY.running;
  return LIVE_TASK_PRIORITY.rest;
}
