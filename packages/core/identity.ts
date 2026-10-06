import type { SessionIdentity } from "../contracts";

export function sameIdentity(a: SessionIdentity, b: SessionIdentity): boolean {
  return a.sessionId === b.sessionId && a.targetId === b.targetId && a.epoch === b.epoch;
}
