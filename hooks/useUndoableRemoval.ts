"use client";

/**
 * Remove with Undo: the row hides at once and a toast offers Undo for a few
 * seconds before the delete is sent, one removal at a time. Closing the panel
 * or leaving the page sends whatever is still waiting (keepalive outlives it).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "@/components/ui/Toast";

/** How long Undo is offered before a removal is sent. */
export const UNDO_WINDOW_MS = 6000;

/** Sends one removal; resolves false when it didn't go through. */
export type SendRemoval = (id: string, options: { keepalive: boolean }) => Promise<boolean>;

export function useUndoableRemoval(send: SendRemoval, labels: { removed: string; undo: string }) {
  const { addToast, removeToast } = useToast();
  // Waiting, being sent, or sent: a removal that went through stays hidden.
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const waiting = useRef(new Map<string, { timer: ReturnType<typeof setTimeout>; toastId: string }>());
  const queue = useRef<Promise<void>>(Promise.resolve());
  const latest = useRef({ send, removeToast });
  useEffect(() => {
    latest.current = { send, removeToast };
  });

  const setShown = useCallback((id: string, shown: boolean) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (shown) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const commit = useCallback(
    (id: string) => {
      if (!waiting.current.delete(id)) return;
      queue.current = queue.current.then(async () => {
        const sent = await latest.current.send(id, { keepalive: false }).catch(() => false);
        if (!sent) setShown(id, true);
      });
    },
    [setShown],
  );

  const undo = useCallback(
    (id: string) => {
      const entry = waiting.current.get(id);
      if (!entry) return; // already sent
      clearTimeout(entry.timer);
      waiting.current.delete(id);
      setShown(id, true);
    },
    [setShown],
  );

  const remove = useCallback(
    (id: string) => {
      if (waiting.current.has(id)) return;
      setShown(id, false);
      const toastId = addToast(labels.removed, "success", UNDO_WINDOW_MS, { label: labels.undo, onClick: () => undo(id) });
      waiting.current.set(id, { timer: setTimeout(() => commit(id), UNDO_WINDOW_MS), toastId });
    },
    [addToast, commit, labels.removed, labels.undo, setShown, undo],
  );

  useEffect(() => {
    const pending = waiting.current;
    const sendNow = () => {
      for (const [id, { timer, toastId }] of pending) {
        clearTimeout(timer);
        latest.current.removeToast(toastId);
        void latest.current.send(id, { keepalive: true }).catch(() => false);
      }
      pending.clear();
    };
    window.addEventListener("pagehide", sendNow);
    return () => {
      window.removeEventListener("pagehide", sendNow);
      sendNow();
    };
  }, []);

  return { hidden, remove };
}
