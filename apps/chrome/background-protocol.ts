import type { CaptionRevision, MediaTarget, SessionIdentity } from "../../packages/contracts";

export type BackgroundSnapshot = {
  state: "idle" | "preparing" | "ready" | "starting" | "running" | "stopping" | "failed";
  source: "ja" | "en";
  tabId?: number;
  message: string;
  diagnostic?: string;
  target?: MediaTarget;
  identity?: SessionIdentity;
  captions: CaptionRevision[];
};

export type BackgroundCommand =
  | { type: "snapshot" | "stop" }
  | { type: "prepare"; tabId: number; source: "ja" | "en" }
  | { type: "start"; tabId: number; streamId: string };

export const backgroundChannel = "interpreter-background-v1";
export const controlChannel = "interpreter-control-v1";
export const eventChannel = "interpreter-event-v1";
