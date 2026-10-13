import type { ParticipantsResponse } from "./shared";

/**
 * The share page shows one person's "I'm going" state in two places, the bar
 * at the top and the email ask at the bottom. Whichever hears from the server
 * publishes the answer here, so both show it.
 */

type Listener = (snapshot: ParticipantsResponse) => void;

const latest = new Map<string, ParticipantsResponse>();
const listeners = new Map<string, Set<Listener>>();

export function publishParticipants(shareToken: string, snapshot: ParticipantsResponse): void {
  latest.set(shareToken, snapshot);
  listeners.get(shareToken)?.forEach((listener) => listener(snapshot));
}

/** Calls `listener` with the latest answer, if any, and with each one after. */
export function subscribeParticipants(shareToken: string, listener: Listener): () => void {
  let set = listeners.get(shareToken);
  if (!set) {
    set = new Set();
    listeners.set(shareToken, set);
  }
  set.add(listener);
  const current = latest.get(shareToken);
  if (current) listener(current);
  return () => {
    set.delete(listener);
  };
}
