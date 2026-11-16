"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Spinner } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";

const BaseModal = dynamic(() => import("@/components/ui/BaseModal"), { ssr: false });

/** The statuses the owner moves a trip between on the trip page. */
export type OwnerTripStatus = "confirmed" | "cancelled" | "planning";

const STATUS_COLORS = {
  planning: "bg-amber-100 text-amber-700",
  confirmed: "bg-green-100 text-green-700",
  active: "bg-blue-100 text-blue-700",
  completed: "bg-purple-100 text-purple-700",
  cancelled: "bg-red-100 text-red-700",
};

/**
 * A trip's status as its owner changes it: confirm a planning trip, cancel
 * it, restore a cancelled one. A change is saved, confirmed with a toast and
 * followed by a refresh of the page's server data; a failed one keeps the
 * status and says so.
 */
export function useTripStatus(tripId: string, initialStatus: string) {
  const t = useTranslations("trips");
  const tTrips = useTranslations("common.trips");
  const router = useRouter();
  const { addToast } = useToast();
  const [status, setStatus] = useState(initialStatus);
  const [updating, setUpdating] = useState(false);

  const update = async (newStatus: OwnerTripStatus) => {
    setUpdating(true);
    try {
      const response = await fetch(`/api/trips/${tripId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });

      if (!response.ok) {
        throw new Error(`status ${response.status}`);
      }

      setStatus(newStatus);
      addToast(
        newStatus === "confirmed"
          ? tTrips("tripConfirmed")
          : newStatus === "planning"
            ? tTrips("tripRestored")
            : tTrips("tripCancelled"),
        "success"
      );
      router.refresh();
    } catch (error) {
      console.error("Error updating status:", error);
      // The server's text is English (and sometimes an object).
      addToast(t("detail.cancelTrip.failed"), "error");
    } finally {
      setUpdating(false);
    }
  };

  return { status, updating, update };
}

/** The status pill on the trip's hero. */
export function TripStatusBadge({ status }: { status: string }) {
  const tTrips = useTranslations("common.trips");
  const label =
    status === "completed"
      ? tTrips("memories")
      : status === "active"
        ? tTrips("active") // "Ongoing"
        : tTrips(status as "planning" | "confirmed" | "cancelled");
  return (
    <span
      className={`px-3 py-1.5 rounded-full text-sm font-medium shadow-lg ${
        STATUS_COLORS[status as keyof typeof STATUS_COLORS] || STATUS_COLORS.planning
      }`}
    >
      {label}
    </span>
  );
}

/** A planning trip's call to confirm it, or to cancel it (which asks first). */
export function ConfirmTripCard({
  updating,
  onConfirm,
  onCancel,
}: {
  updating: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const tTrips = useTranslations("common.trips");
  return (
    <div className="mb-6 bg-gradient-to-r from-amber-50 to-orange-50 rounded-2xl p-6 border border-amber-200">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
            <svg className="w-6 h-6 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <h3 className="font-bold text-slate-900">{tTrips("readyToConfirm")}</h3>
            <p className="text-sm text-slate-600 mt-1">
              {tTrips("confirmTripDescription")}
            </p>
          </div>
        </div>
        <div className="flex gap-3 w-full sm:w-auto">
          {/* Asks before cancelling: a bare "Cancel" reads like
              "dismiss". */}
          <button
            onClick={onCancel}
            disabled={updating}
            className="flex-1 sm:flex-none px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-medium hover:bg-slate-50 transition-colors disabled:opacity-50"
          >
            {tTrips("cancelTrip")}
          </button>
          <button
            onClick={onConfirm}
            disabled={updating}
            className="flex-1 sm:flex-none px-6 py-2.5 rounded-xl bg-green-700 text-white font-medium hover:bg-green-800 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {updating ? (
              <Spinner className="w-5 h-5" />
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                {tTrips("confirmTrip")}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/** A cancelled trip's note, with the way back to planning. */
export function CancelledTripNote({ updating, onRestore }: { updating: boolean; onRestore: () => void }) {
  const t = useTranslations("trips");
  const tTrips = useTranslations("common.trips");
  return (
    <div className="mb-6 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-slate-700">{t("detail.cancelTrip.cancelledNote")}</p>
      <button
        type="button"
        onClick={onRestore}
        disabled={updating}
        className="flex-shrink-0 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-100 disabled:opacity-50"
      >
        {tTrips("restoreTrip")}
      </button>
    </div>
  );
}

/** "Cancel this trip?": cancelling turns off the countdown, checklist and reminders. */
export function CancelTripDialog({
  isOpen,
  onClose,
  onConfirm,
}: {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const t = useTranslations("trips");
  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      // Above the page's sticky bars (z-50), like every dialog here.
      usePortal
      zIndex={100}
      title={t("detail.cancelTrip.title")}
    >
      <p className="text-sm text-slate-600">{t("detail.cancelTrip.body")}</p>
      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={onClose}
          className="rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100"
        >
          {t("detail.cancelTrip.keep")}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700"
        >
          {t("detail.cancelTrip.confirm")}
        </button>
      </div>
    </BaseModal>
  );
}
