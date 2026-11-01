"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { isCompleteOtpCode, normalizeOtpCode } from "@/lib/auth/otp-code";
import { useModalBehavior } from "@/lib/hooks/useModalBehavior";

interface DeleteAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Where the code is sent, shown so people know which inbox to check. */
  email: string;
  /**
   * Accounts with an email sign-in may confirm with their password instead.
   * Everyone can confirm with a code: Google sign-ins have no password.
   */
  canUsePassword: boolean;
  /** Called once the account is gone: sign out and leave the page. */
  onDeleted: () => void;
}

type Mode = "code" | "password";

// Long enough to read the confirmation before the page changes.
const DELETED_NOTICE_MS = 1500;

export default function DeleteAccountModal({
  isOpen,
  onClose,
  email,
  canUsePassword,
  onDeleted,
}: DeleteAccountModalProps) {
  const t = useTranslations("common.deleteAccount");
  const tc = useTranslations("common.buttons");
  const locale = useLocale();
  const [mode, setMode] = useState<Mode>("code");
  const [codeSent, setCodeSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClose = () => {
    if (deleting || deleted) return;
    setMode("code");
    setCode("");
    setPassword("");
    setError(null);
    onClose();
  };
  const { panelRef } = useModalBehavior({ isOpen, onClose: handleClose });

  if (!isOpen) return null;

  const canDelete =
    mode === "code" ? codeSent && isCompleteOtpCode(code) : password.length > 0;

  const sendCode = async () => {
    if (sending || deleting) return;
    setSending(true);
    setError(null);
    try {
      const response = await fetch("/api/profile/delete/code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale }),
      });
      if (!response.ok) {
        setError(t(response.status === 429 ? "errors.rateLimited" : "errors.sendFailed"));
        return;
      }
      setCodeSent(true);
      setCode("");
    } catch {
      setError(t("errors.sendFailed"));
    } finally {
      setSending(false);
    }
  };

  const handleConfirm = async () => {
    if (!canDelete || deleting) return;
    setDeleting(true);
    setError(null);
    try {
      const response = await fetch("/api/profile/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mode === "code" ? { code } : { password }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(
          response.status === 429
            ? t("errors.rateLimited")
            : data.code === "CODE_INVALID"
              ? t("errors.codeInvalid")
              : data.code === "PASSWORD_INCORRECT"
                ? t("errors.passwordIncorrect")
                : t("deleteError")
        );
        setDeleting(false);
        return;
      }
      setDeleted(true);
      setTimeout(onDeleted, DELETED_NOTICE_MS);
    } catch {
      setError(t("deleteError"));
      setDeleting(false);
    }
  };

  const switchMode = () => {
    setMode(mode === "code" ? "password" : "code");
    setError(null);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Modal */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-account-title"
        tabIndex={-1}
        className="relative bg-white rounded-2xl sm:rounded-3xl w-full max-w-md p-6 shadow-2xl outline-none animate-in slide-in-from-bottom-4 sm:slide-in-from-bottom-0 sm:zoom-in-95 duration-300"
      >
        {deleted ? (
          <div role="status" className="py-6 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-emerald-100 flex items-center justify-center">
              <svg className="w-8 h-8 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p id="delete-account-title" className="text-lg font-semibold text-slate-900">
              {t("deleted")}
            </p>
          </div>
        ) : (
          <>
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

            <h3 id="delete-account-title" className="text-xl font-bold text-center text-slate-900 mb-2">
              {t("title")}
            </h3>

            <p className="text-slate-600 text-center mb-4">
              {t("warning")}
            </p>

            <ul className="text-sm text-slate-500 mb-4 space-y-1 pl-4">
              <li className="flex items-start gap-2">
                <span className="text-red-400">•</span>
                {t("items.trips")}
              </li>
              <li className="flex items-start gap-2">
                <span className="text-red-400">•</span>
                {t("items.conversations")}
              </li>
              <li className="flex items-start gap-2">
                <span className="text-red-400">•</span>
                {t("items.preferences")}
              </li>
              <li className="flex items-start gap-2">
                <span className="text-red-400">•</span>
                {t("items.checklists")}
              </li>
            </ul>

            <p className="text-red-600 text-sm font-medium text-center mb-4">
              {t("cannotUndo")}
            </p>

            {/* Step-up: a code sent to the account's email, or the password */}
            {mode === "code" ? (
              codeSent ? (
                <div className="mb-4">
                  <p className="text-sm text-slate-600 mb-3">{t("codeSent", { email })}</p>
                  <label
                    htmlFor="delete-confirm-code"
                    className="block text-sm font-medium text-slate-700 mb-2"
                  >
                    {t("codeLabel")}
                  </label>
                  <input
                    id="delete-confirm-code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={code}
                    onChange={(e) => setCode(normalizeOtpCode(e.target.value))}
                    className="w-full px-4 py-3 border border-slate-200 rounded-xl text-center text-lg font-mono tracking-[0.4em] focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent transition-all"
                    placeholder="000000"
                    disabled={deleting}
                  />
                  <button
                    type="button"
                    onClick={sendCode}
                    disabled={sending || deleting}
                    className="mt-2 text-sm text-slate-600 underline underline-offset-2 hover:text-slate-900 disabled:opacity-50"
                  >
                    {sending ? t("sendingCode") : t("resendCode")}
                  </button>
                </div>
              ) : (
                <p className="text-sm text-slate-600 mb-4">{t("codeIntro", { email })}</p>
              )
            ) : (
              <div className="mb-4">
                <label
                  htmlFor="delete-confirm-password"
                  className="block text-sm font-medium text-slate-700 mb-2"
                >
                  {t("passwordLabel")}
                </label>
                <input
                  id="delete-confirm-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent transition-all"
                  placeholder="••••••••"
                  disabled={deleting}
                  autoComplete="current-password"
                />
              </div>
            )}

            {canUsePassword && (
              <button
                type="button"
                onClick={switchMode}
                disabled={deleting}
                className="block mb-4 text-sm text-slate-600 underline underline-offset-2 hover:text-slate-900 disabled:opacity-50"
              >
                {mode === "code" ? t("usePassword") : t("useCode")}
              </button>
            )}

            {error && (
              <p role="alert" className="text-sm text-red-600 text-center mb-4">
                {error}
              </p>
            )}

            {/* Buttons */}
            <div className="flex gap-3">
              <button
                onClick={handleClose}
                disabled={deleting}
                className="flex-1 px-4 py-3 rounded-xl font-medium border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {tc("cancel")}
              </button>
              {mode === "code" && !codeSent ? (
                <button
                  onClick={sendCode}
                  disabled={sending}
                  className="flex-1 px-4 py-3 rounded-xl font-medium bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {sending ? t("sendingCode") : t("sendCode")}
                </button>
              ) : (
                <button
                  onClick={handleConfirm}
                  disabled={!canDelete || deleting}
                  className="flex-1 px-4 py-3 rounded-xl font-medium bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {deleting ? (
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
                      {t("deleting")}
                    </>
                  ) : (
                    t("confirm")
                  )}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
