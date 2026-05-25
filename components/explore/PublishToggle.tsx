"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import PublishTripModal from "./PublishTripModal";

interface PublishToggleProps {
  tripId: string;
  isPublic: boolean;
  /** Default author name for the modal (prefilled from profile). */
  defaultAuthorName?: string;
}

/**
 * Owner-side publish toggle. Two states:
 *
 *   - private → button "Publish to Explore" → opens PublishTripModal
 *   - public  → button "Public ✓ (Unpublish)" → DELETE the publish
 *
 * Lives next to the EngagementBar on /trips/[id]. Hidden when the
 * explore feature flag is off (the parent server wrapper handles
 * the flag check).
 */
export default function PublishToggle({
  tripId,
  isPublic,
  defaultAuthorName,
}: PublishToggleProps) {
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function unpublish() {
    if (busy) return;
    if (!confirm("Remove this trip from Explore? You can re-publish anytime.")) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/trips/${tripId}/publish`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || `Unpublish failed (${res.status})`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unpublish failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {isPublic ? (
        <button
          onClick={unpublish}
          disabled={busy}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-sm font-medium hover:bg-emerald-100 transition-all disabled:opacity-60"
          title="Click to remove from /explore"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          Public {busy ? "..." : "(Unpublish)"}
        </button>
      ) : (
        <button
          onClick={() => setModalOpen(true)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--accent)] text-slate-900 text-sm font-bold hover:opacity-90 transition-all shadow-sm"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Publish to Explore
        </button>
      )}

      {error && (
        <span className="text-xs text-rose-600 ml-2" role="alert">
          {error}
        </span>
      )}

      <PublishTripModal
        tripId={tripId}
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        defaultAuthorName={defaultAuthorName}
      />
    </>
  );
}
