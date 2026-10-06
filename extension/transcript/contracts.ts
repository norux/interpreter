import type { Caption } from "../captions/contracts";
import type { CaptureStatus } from "../capture/contracts";

export type TranscriptMessage =
  | { target: "transcript"; type: "snapshot"; sessionId?: string; captions: Caption[]; dropped: number }
  | { target: "transcript"; type: "caption"; caption: Caption; dropped: number; removedId?: string }
  | { target: "transcript"; type: "status"; status: CaptureStatus };
