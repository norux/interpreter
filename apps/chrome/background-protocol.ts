import type { CaptionRevision, MediaTarget, SessionIdentity } from "../../packages/contracts";
import type { ModelOptions } from "./model-options";

export type BackgroundSnapshot = {
  state: "idle" | "preparing" | "ready" | "starting" | "running" | "stopping" | "failed";
  source: "ja" | "en" | "ko" | "auto";
  tabId?: number;
  options?: ModelOptions;
  message: string;
  diagnostic?: string;
  downloadProgress?: number;
  models?: { task: string; name: string }[];
  target?: MediaTarget;
  identity?: SessionIdentity;
  captions: CaptionRevision[];
};

export type BackgroundCommand =
  | { type: "snapshot" | "stop" }
  | { type: "prepare"; tabId: number; source: "ja" | "en" | "ko" | "auto"; options?: ModelOptions }
  | { type: "models"; tabId?: number; source: "ja" | "en" | "ko" | "auto"; options: ModelOptions }
  | { type: "start"; tabId: number; streamId: string };

export const backgroundChannel = "interpreter-background-v1";
export const controlChannel = "interpreter-control-v1";
export const eventChannel = "interpreter-event-v1";
