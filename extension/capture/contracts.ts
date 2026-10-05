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
}

export type CaptureCommand =
  | { target: "worker"; type: "start" | "stop" | "status" }
  | { target: "offscreen"; type: "start"; streamId: string; tabId: number }
  | { target: "offscreen"; type: "stop" | "status" }
  | { target: "worker"; type: "capture-status"; status: CaptureStatus };
