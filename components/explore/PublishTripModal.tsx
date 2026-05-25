"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface PublishTripModalProps {
  tripId: string;
  isOpen: boolean;
  onClose: () => void;
  /** Pre-fill the author name from the user profile. */
  defaultAuthorName?: string;
  /** Called after successful publish so the parent can refresh state. */
  onPublished?: (data: { tripId: string; shareToken: string }) => void;
}

const MAX_NAME = 80;
const MAX_NOTE = 280;

/**
 * Publish-to-explore modal.
 *
 * Shown when the owner clicks "Make public" on /trips/[id]. Collects:
 *   - author_display_name (optional, defaults to profile name)
 *   - author_note (optional, max 280 chars, shown on the explore card)
 *
 * Displays a clear disclosure of what going public means:
 *   - Visible on /explore + /shared/[token]
 *   - Anyone can copy + customize
 *   - Reversible via /trips/[id]/publish DELETE
 *
 * On submit, POST /api/trips/[id]/publish. Server enforces 4 anti-spam
 * guards (age, depth, duration, weekly rate); we surface its 400 error
 * verbatim if any fails so the user understands why.
 */
export default function PublishTripModal({
  tripId,
  isOpen,
  onClose,
  defaultAuthorName,
  onPublished,
}: PublishTripModalProps) {
  const router = useRouter();
  const [authorName, setAuthorName] = useState(defaultAuthorName ?? "");
  const [authorNote, setAuthorNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setError(null);
      // Don't reset authorName/Note across opens — preserve user typing
      // in case the publish failed for an anti-spam reason and they want
      // to retry later.
    }
  }, [isOpen]);

  const submit = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/trips/${tripId}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          authorDisplayName: authorName.trim() || undefined,
          authorNote: authorNote.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `Publish failed (${res.status})`);
      }
      onPublished?.({ tripId: data.tripId, shareToken: data.shareToken });
      // Refresh server state so the /trips/[id] page re-renders with
      // visibility=public + new toggle state.
      router.refresh();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Publish failed");
    } finally {
      setBusy(false);
    }
  }, [busy, authorName, authorNote, tripId, onPublished, router, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="publish-modal-title"
    >
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="bg-gradient-to-br from-[var(--primary)] to-[var(--primary)]/80 px-6 py-7 text-white">
          <h2 id="publish-modal-title" className="text-2xl font-bold mb-1">
            Publish to Explore
          </h2>
          <p className="text-white/85 text-sm">
            Share your trip with the community
          </p>
        </div>

        <div className="px-6 py-6 space-y-5">
          {/* Disclosure */}
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 text-sm text-slate-700 leading-relaxed">
            <p className="font-medium text-slate-900 mb-1">
              When you publish:
            </p>
            <ul className="space-y-1 list-disc pl-5">
              <li>Your trip appears in the public <strong>Explore</strong> feed</li>
              <li>Anyone can view, save, or copy (&quot;fork&quot;) it as a starting point</li>
              <li>You can unpublish anytime from the same toggle</li>
            </ul>
          </div>

          <div>
            <label
              htmlFor="author-display-name"
              className="block text-sm font-medium text-slate-700 mb-1.5"
            >
              Author name <span className="text-slate-400">(optional)</span>
            </label>
            <input
              id="author-display-name"
              type="text"
              maxLength={MAX_NAME}
              value={authorName}
              onChange={(e) => setAuthorName(e.target.value)}
              placeholder="Anonymous traveler"
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
            />
            <p className="mt-1 text-xs text-slate-500">
              How you&apos;ll be credited on the explore card. {authorName.length}/{MAX_NAME}
            </p>
          </div>

          <div>
            <label
              htmlFor="author-note"
              className="block text-sm font-medium text-slate-700 mb-1.5"
            >
              Trip note <span className="text-slate-400">(optional)</span>
            </label>
            <textarea
              id="author-note"
              maxLength={MAX_NOTE}
              rows={3}
              value={authorNote}
              onChange={(e) => setAuthorNote(e.target.value)}
              placeholder="e.g., Honeymoon in May, prioritized hidden gems and slow mornings"
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)] resize-none"
            />
            <p className="mt-1 text-xs text-slate-500">
              A short blurb shown under the title. {authorNote.length}/{MAX_NOTE}
            </p>
          </div>

          {error && (
            <div className="rounded-lg bg-rose-50 border border-rose-200 p-3 text-sm text-rose-700">
              {error}
            </div>
          )}

          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={onClose}
              disabled={busy}
              className="flex-1 px-4 py-2.5 rounded-lg border border-slate-300 text-slate-700 font-medium hover:bg-slate-50 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={busy}
              className="flex-1 px-4 py-2.5 rounded-lg bg-[var(--primary)] text-white font-semibold hover:opacity-95 transition-all shadow-sm disabled:opacity-60"
            >
              {busy ? "Publishing..." : "Publish trip"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
