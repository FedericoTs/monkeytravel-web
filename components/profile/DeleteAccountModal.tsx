"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

interface DeleteAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * Called when the user confirms. The modal collects:
   *   - confirmationText (the exact "delete my account" phrase)
   *   - password (for step-up re-authentication on the server)
   *
   * Both are forwarded as-is so the API can re-check them server-side.
   */
  onConfirm: (args: {
    confirmationText: string;
    password: string;
  }) => Promise<void>;
  isDeleting: boolean;
}

// Must match REQUIRED_CONFIRMATION on the server route.
const REQUIRED_CONFIRMATION = "delete my account";

export default function DeleteAccountModal({
  isOpen,
  onClose,
  onConfirm,
  isDeleting,
}: DeleteAccountModalProps) {
  const t = useTranslations('common.deleteAccount');
  const tc = useTranslations('common.buttons');
  const [confirmText, setConfirmText] = useState("");
  const [password, setPassword] = useState("");
  const phraseMatches =
    confirmText.trim().toLowerCase() === REQUIRED_CONFIRMATION;
  const canDelete = phraseMatches && password.length > 0;

  if (!isOpen) return null;

  const handleConfirm = async () => {
    if (!canDelete || isDeleting) return;
    await onConfirm({ confirmationText: confirmText.trim(), password });
  };

  const handleClose = () => {
    if (isDeleting) return;
    setConfirmText("");
    setPassword("");
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Modal */}
      <div className="relative bg-white rounded-2xl sm:rounded-3xl w-full max-w-md p-6 shadow-2xl animate-in slide-in-from-bottom-4 sm:slide-in-from-bottom-0 sm:zoom-in-95 duration-300">
        {/* Warning Icon */}
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-100 flex items-center justify-center">
          <svg
            className="w-8 h-8 text-red-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
            />
          </svg>
        </div>

        <h3 className="text-xl font-bold text-center text-slate-900 mb-2">
          {t('title')}
        </h3>

        <p className="text-slate-600 text-center mb-4">
          {t('warning')}
        </p>

        <ul className="text-sm text-slate-500 mb-4 space-y-1 pl-4">
          <li className="flex items-start gap-2">
            <span className="text-red-400">•</span>
            {t('items.trips')}
          </li>
          <li className="flex items-start gap-2">
            <span className="text-red-400">•</span>
            {t('items.conversations')}
          </li>
          <li className="flex items-start gap-2">
            <span className="text-red-400">•</span>
            {t('items.preferences')}
          </li>
          <li className="flex items-start gap-2">
            <span className="text-red-400">•</span>
            {t('items.checklists')}
          </li>
        </ul>

        <p className="text-red-600 text-sm font-medium text-center mb-4">
          {t('cannotUndo')}
        </p>

        {/* Confirmation phrase */}
        <div className="mb-4">
          <label
            htmlFor="delete-confirm-phrase"
            className="block text-sm font-medium text-slate-700 mb-2"
          >
            Type{" "}
            <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">
              {REQUIRED_CONFIRMATION}
            </span>{" "}
            to confirm
          </label>
          <input
            id="delete-confirm-phrase"
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent transition-all"
            placeholder={REQUIRED_CONFIRMATION}
            disabled={isDeleting}
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        {/* Password (step-up re-auth) */}
        <div className="mb-6">
          <label
            htmlFor="delete-confirm-password"
            className="block text-sm font-medium text-slate-700 mb-2"
          >
            Enter your password to confirm
          </label>
          <input
            id="delete-confirm-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent transition-all"
            placeholder="••••••••"
            disabled={isDeleting}
            autoComplete="current-password"
          />
        </div>

        {/* Buttons */}
        <div className="flex gap-3">
          <button
            onClick={handleClose}
            disabled={isDeleting}
            className="flex-1 px-4 py-3 rounded-xl font-medium border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {tc('cancel')}
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canDelete || isDeleting}
            className="flex-1 px-4 py-3 rounded-xl font-medium bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isDeleting ? (
              <>
                <svg
                  className="w-4 h-4 animate-spin"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                {t('deleting')}
              </>
            ) : (
              tc('delete')
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
