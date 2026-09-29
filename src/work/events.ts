import type { StageName } from "../types/stages.js";
import type { WorkEvent } from "../types/work.js";
import { appendEvent } from "./store.js";

export function emit(
  repoRoot: string,
  workId: string,
  type: string,
  stage?: StageName,
  data?: Record<string, unknown>,
): WorkEvent {
  const event: WorkEvent = {
    at: new Date().toISOString(),
    workId,
    type,
    stage,
    data,
  };
  appendEvent(repoRoot, event);
  return event;
}
