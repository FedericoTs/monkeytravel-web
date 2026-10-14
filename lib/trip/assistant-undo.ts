/**
 * Undo for the wizard assistant's edits, which apply as soon as they arrive.
 * Each edit keeps the plan just before and just after it, and Undo hands the
 * "before" back only while the plan is still exactly the "after", so it can
 * never wipe a change made since (a later edit, new dates, a regeneration).
 */

export interface UndoEntry<P, E> {
  before: P;
  after: P;
  /** Anything else the edit changed, restored with the plan. */
  extra: E;
}

export function createUndoLedger<P, E>() {
  const entries = new Map<string, UndoEntry<P, E>>();
  let count = 0;
  return {
    record(before: P, after: P, extra: E): string {
      const id = `edit-${++count}`;
      entries.set(id, { before, after, extra });
      return id;
    },
    /** The entry to restore, or null when the plan has moved on since that edit. */
    take(id: string, current: P): UndoEntry<P, E> | null {
      const entry = entries.get(id);
      if (!entry || entry.after !== current) return null;
      entries.delete(id);
      return entry;
    },
  };
}
