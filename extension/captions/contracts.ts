import type { FrameworkEnvelope } from "../../packages/contracts";

export interface Caption {
  sessionId: string;
  utteranceId: string;
  revision: number;
  source: string;
  translation: string;
  final: boolean;
  audioStartMs: number;
  audioEndMs: number;
  emittedAtMs: number;
  framework?: FrameworkEnvelope;
}

export type SessionEvent =
  | { type: "caption"; caption: Caption }
  | { type: "status" | "error"; sessionId: string; message: string }
  | { type: "clear"; sessionId: string };

export interface OutputSink {
  caption(caption: Caption): void;
  status(message: string): void;
  clear(): void;
  dispose(): void;
}

export type CaptionCommand =
  | { target: "captions"; type: "start" | "clear"; sessionId: string }
  | { target: "captions"; type: "caption"; caption: Caption };
