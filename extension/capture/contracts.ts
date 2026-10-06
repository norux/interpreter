import type { SessionSettings } from "./settings";
import type { Caption } from "../captions/contracts";

export interface AudioSource {
  // Frames use the PCM1 header in capture/pcm.ts: sequence, timestamp, rate, mono PCM16.
  start(streamId: string, onFrame: (packet: ArrayBuffer) => void): Promise<void>;
  stop(): Promise<void>;
}

export interface CaptureStatus {
  state: "idle" | "starting" | "capturing" | "error";
  message: string;
  sessionId?: string;
  tabId?: number;
  frames?: number;
  samples?: number;
  peak?: number;
  installRequired?: boolean;
}

export type CaptureCommand =
  | { target: "worker"; type: "start" | "stop" | "status" }
  | { target: "worker"; type: "configure"; settings: SessionSettings }
  | { target: "worker"; type: "settings" }
  | { target: "worker"; type: "install-companion" }
  | { target: "offscreen"; type: "start"; tabId: number; settings?: SessionSettings }
  | { target: "worker"; type: "stream-id"; tabId: number }
  | { target: "offscreen"; type: "stop" | "status" }
  | { target: "worker"; type: "caption"; caption: Caption }
  | { target: "worker"; type: "capture-status"; status: CaptureStatus };
