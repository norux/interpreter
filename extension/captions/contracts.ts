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
