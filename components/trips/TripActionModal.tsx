"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

interface TripActionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  tripTitle: string;
  action: "archive" | "delete" | "unarchive";
}

export default function TripActionModal({
  isOpen,
  onClose,
  onConfirm,
  tripTitle,
  action,
}: TripActionModalProps) {
  const t = useTranslations("common.trips");
  const tButtons = useTranslations("common.buttons");
  const [isLoading, setIsLoading] = useState(false);

  if (!isOpen) return null;

  const handleConfirm = async () => {
    setIsLoading(true);
    try {
      await onConfirm();
      onClose();
    } catch (error) {
      console.error("Action failed:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const getTitle = () => {
    switch (action) {
      case "archive":
        return t("confirmArchive");
      case "delete":
        return t("confirmDelete");
      case "unarchive":
        return t("unarchiveTrip");
      default:
        return "";
    }
  };

  const getMessage = () => {
    switch (action) {
      case "archive":
        return t("confirmArchiveMessage");
      case "delete":
        return t("confirmDeleteMessage");
      case "unarchive":
        return `${tripTitle} will be restored to your main trips view.`;
      default:
        return "";
    }
  };

  const getButtonColor = () => {
    switch (action) {
      case "delete":
        return "bg-red-600 hover:bg-red-700";
      case "archive":
        return "bg-amber-600 hover:bg-amber-700";
      case "unarchive":
        return "bg-green-600 hover:bg-green-700";
      default:
        return "bg-[var(--primary)] hover:bg-[var(--primary)]/90";
    }
  };

  const getIcon = () => {
    switch (action) {
      case "delete":
        return (
          <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        );
      case "archive":
        return (
          <svg className="w-6 h-6 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
          </svg>
        );
      case "unarchive":
        return (
          <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        );
      default:
        return null;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-xl max-w-sm w-full p-6 animate-in fade-in zoom-in-95 duration-200">
        {/* Icon */}
        <div className={`w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4 ${
          action === "delete" ? "bg-red-100" :
          action === "archive" ? "bg-amber-100" : "bg-green-100"
        }`}>
          {getIcon()}
        </div>

        {/* Title */}
        <h3 className="text-lg font-bold text-slate-900 text-center mb-2">
          {getTitle()}
        </h3>

        {/* Trip Title */}
        <p className="text-sm text-slate-600 text-center mb-2 font-medium truncate">
          &quot;{tripTitle}&quot;
        </p>

        {/* Message */}
        <p className="text-sm text-slate-500 text-center mb-6">
          {getMessage()}
        </p>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            disabled={isLoading}
            className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-medium hover:bg-slate-50 transition-colors disabled:opacity-50"
          >
            {tButtons("cancel")}
          </button>
          <button
            onClick={handleConfirm}
            disabled={isLoading}
            className={`flex-1 px-4 py-2.5 rounded-xl text-white font-medium transition-colors disabled:opacity-50 ${getButtonColor()}`}
          >
            {isLoading ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              </span>
            ) : (
              action === "delete" ? t("deleteTrip") :
              action === "archive" ? t("archiveTrip") :
              t("unarchiveTrip")
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
