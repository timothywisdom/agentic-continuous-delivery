import type { StageName } from "../types/stages.js";

/** Stage paused: repair loops exhausted or human amend requested before continue. */
export class NeedsGuidanceError extends Error {
  constructor(
    message: string,
    readonly stage: StageName,
    readonly feedback: string,
  ) {
    super(message);
    this.name = "NeedsGuidanceError";
  }
}
