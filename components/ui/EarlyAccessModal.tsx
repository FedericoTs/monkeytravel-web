"use client";

import { useState, useEffect } from "react";
import { X, Sparkles, Key, Mail, Check, Loader2, Lock, Zap, Gift } from "lucide-react";

interface EarlyAccessModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRedeemCode: (code: string) => Promise<boolean>;
  error?: string | null;
}

/**
 * Premium Early Access Modal
 *
 * Displayed when users try to access AI features without early access.
 * Provides two paths:
 * 1. Enter a tester code to unlock access
 * 2. Join the waitlist for the next wave
 *
 * Design principles:
 * - Premium feel, not an error page
 * - Clear value proposition
 * - Minimal friction
 */
export default function EarlyAccessModal({
  isOpen,
  onClose,
  onRedeemCode,
  error: externalError,
}: EarlyAccessModalProps) {
  const [code, setCode] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [showWaitlistForm, setShowWaitlistForm] = useState(false);
  const [email, setEmail] = useState("");
  const [waitlistSuccess, setWaitlistSuccess] = useState(false);
  const [waitlistSubmitting, setWaitlistSubmitting] = useState(false);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setCode("");
      setError(null);
      setSuccess(false);
      setShowWaitlistForm(false);
      setEmail("");
      setWaitlistSuccess(false);
    }
  }, [isOpen]);

  // Sync external error
  useEffect(() => {
    if (externalError) {
      setError(externalError);
    }
  }, [externalError]);

  if (!isOpen) return null;

  const handleSubmitCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim() || isSubmitting) return;

    setIsSubmitting(true);
    setError(null);

    const result = await onRedeemCode(code.trim().toUpperCase());

    if (result) {
      setSuccess(true);
      setTimeout(() => {
        onClose();
      }, 1500);
    }

    setIsSubmitting(false);
  };

  const handleJoinWaitlist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || waitlistSubmitting) return;

    setWaitlistSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          source: "early_access_waitlist",
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to join waitlist");
      }

      setWaitlistSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to join waitlist");
    } finally {
      setWaitlistSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-full hover:bg-gray-100 transition-colors z-10"
          aria-label="Close"
        >
          <X className="w-5 h-5 text-gray-500" />
        </button>

        {/* Header with gradient */}
        <div className="bg-gradient-to-br from-[var(--primary)] to-[#0A3A5C] px-6 pt-8 pb-6 text-white">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-white/20 rounded-xl backdrop-blur-sm">
              <Sparkles className="w-6 h-6" />
            </div>
            <h2 className="text-xl font-bold">AI Features • Early Access</h2>
          </div>
          <p className="text-white/80 text-sm leading-relaxed">
            Our AI trip planning is currently available to early testers.
            We&apos;re rolling out access in waves to ensure the best experience.
          </p>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Success state */}
          {success ? (
            <div className="text-center py-8">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Check className="w-8 h-8 text-green-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                Welcome to Early Access!
              </h3>
              <p className="text-gray-600">
                You now have access to all AI features.
              </p>
            </div>
          ) : waitlistSuccess ? (
            <div className="text-center py-8">
              <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Mail className="w-8 h-8 text-blue-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                You&apos;re on the list!
              </h3>
              <p className="text-gray-600">
                We&apos;ll email you when early access opens up.
              </p>
            </div>
          ) : (
            <>
              {/* Code entry section */}
              <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                <div className="flex items-center gap-2 mb-3">
                  <Key className="w-4 h-4 text-[var(--primary)]" />
                  <span className="font-medium text-gray-900">Have a tester code?</span>
                </div>

                <form onSubmit={handleSubmitCode} className="flex gap-2">
                  <input
                    type="text"
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    placeholder="Enter code"
                    className="flex-1 px-4 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent font-mono text-center tracking-wider uppercase"
                    maxLength={20}
                    disabled={isSubmitting}
                  />
                  <button
                    type="submit"
                    disabled={!code.trim() || isSubmitting}
                    className="px-4 py-2.5 bg-[var(--primary)] text-white rounded-lg font-medium hover:bg-[var(--primary)]/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                  >
                    {isSubmitting ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      "Unlock"
                    )}
                  </button>
                </form>

                {error && (
                  <p className="mt-2 text-sm text-red-600 flex items-center gap-1">
                    <X className="w-3 h-3" />
                    {error}
                  </p>
                )}
              </div>

              {/* Divider */}
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-200" />
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="px-4 bg-white text-gray-500">or</span>
                </div>
              </div>

              {/* Waitlist section */}
              {showWaitlistForm ? (
                <div className="bg-blue-50 rounded-xl p-4 border border-blue-100">
                  <div className="flex items-center gap-2 mb-3">
                    <Mail className="w-4 h-4 text-blue-600" />
                    <span className="font-medium text-gray-900">Join the Waitlist</span>
                  </div>

                  <form onSubmit={handleJoinWaitlist} className="flex gap-2">
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="your@email.com"
                      className="flex-1 px-4 py-2.5 border border-blue-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                      disabled={waitlistSubmitting}
                    />
                    <button
                      type="submit"
                      disabled={!email.trim() || waitlistSubmitting}
                      className="px-4 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {waitlistSubmitting ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        "Join"
                      )}
                    </button>
                  </form>
                  <p className="mt-2 text-xs text-gray-500">
                    Be first to know when we open the next wave of invites.
                  </p>
                </div>
              ) : (
                <button
                  onClick={() => setShowWaitlistForm(true)}
                  className="w-full py-3 border-2 border-dashed border-gray-200 rounded-xl text-gray-600 hover:border-blue-300 hover:text-blue-600 hover:bg-blue-50/50 transition-colors flex items-center justify-center gap-2"
                >
                  <Mail className="w-4 h-4" />
                  Join Waitlist for Next Wave
                </button>
              )}
            </>
          )}
        </div>

        {/* Footer with benefits */}
        {!success && !waitlistSuccess && (
          <div className="px-6 pb-6">
            <div className="bg-gradient-to-r from-amber-50 to-orange-50 rounded-xl p-4 border border-amber-100">
              <h4 className="text-sm font-semibold text-amber-900 mb-2 flex items-center gap-2">
                <Gift className="w-4 h-4" />
                Early Access Benefits
              </h4>
              <ul className="space-y-1.5 text-sm text-amber-800">
                <li className="flex items-center gap-2">
                  <Lock className="w-3.5 h-3.5 text-amber-600" />
                  Your preferences are saved
                </li>
                <li className="flex items-center gap-2">
                  <Zap className="w-3.5 h-3.5 text-amber-600" />
                  Get personalized AI recommendations
                </li>
                <li className="flex items-center gap-2">
                  <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                  14-day Pro access for early testers
                </li>
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
