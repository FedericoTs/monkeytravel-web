"use client";

import { useState, useEffect } from "react";
import { Gift, Copy, Check, X, Twitter, Mail, Users, Sparkles } from "lucide-react";

interface ReferralStats {
  clicks: number;
  signups: number;
  conversions: number;
}

interface ReferralModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ReferralModal({ isOpen, onClose }: ReferralModalProps) {
  const [code, setCode] = useState<string | null>(null);
  const [stats, setStats] = useState<ReferralStats>({ clicks: 0, signups: 0, conversions: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const referralUrl = code ? `${typeof window !== "undefined" ? window.location.origin : ""}/join/${code}` : "";

  // Fetch referral code on mount
  useEffect(() => {
    if (isOpen) {
      fetchReferralCode();
    }
  }, [isOpen]);

  const fetchReferralCode = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/referral/code");
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to get referral code");
      }

      setCode(data.code);
      setStats(data.stats);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(referralUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const handleShareTwitter = () => {
    const text = encodeURIComponent(
      "I've been using MonkeyTravel to plan amazing AI-powered trips! Join me and get a FREE trip when you sign up:"
    );
    const url = encodeURIComponent(referralUrl);
    window.open(`https://twitter.com/intent/tweet?text=${text}&url=${url}`, "_blank");
  };

  const handleShareWhatsApp = () => {
    const text = encodeURIComponent(
      `Hey! I've been using MonkeyTravel to plan amazing trips with AI. Join me and we both get a FREE trip! ${referralUrl}`
    );
    window.open(`https://wa.me/?text=${text}`, "_blank");
  };

  const handleShareEmail = () => {
    const subject = encodeURIComponent("You're invited to MonkeyTravel - Get a FREE AI trip!");
    const body = encodeURIComponent(
      `Hey!\n\nI've been using MonkeyTravel to plan amazing trips with AI, and I thought you'd love it too.\n\nJoin using my link and we'll both get a FREE AI-generated trip!\n\n${referralUrl}\n\nHappy travels!`
    );
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  };

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (isOpen) document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative min-h-screen flex items-center justify-center p-4">
        <div className="relative bg-white rounded-2xl shadow-xl max-w-md w-full overflow-hidden animate-scale-up">
          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-2 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors z-10"
          >
            <X className="w-5 h-5" />
          </button>

          {/* Header with gradient */}
          <div className="bg-gradient-to-br from-amber-50 via-orange-50 to-rose-50 p-6 pb-8">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-lg shadow-orange-200">
                <Gift className="w-7 h-7 text-white" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-slate-900">
                  Invite Friends, Get Free Trips
                </h3>
                <p className="text-sm text-slate-600 mt-0.5">
                  Give 1 trip, get 1 trip for each friend
                </p>
              </div>
            </div>
          </div>

          {/* Content */}
          <div className="p-6">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="w-8 h-8 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin" />
              </div>
            ) : error ? (
              <div className="text-center py-8">
                <p className="text-red-600 mb-4">{error}</p>
                <button
                  onClick={fetchReferralCode}
                  className="text-[var(--primary)] hover:underline font-medium"
                >
                  Try again
                </button>
              </div>
            ) : (
              <>
                {/* How it works */}
                <div className="mb-6">
                  <h4 className="text-sm font-semibold text-slate-900 mb-3">How it works</h4>
                  <div className="space-y-2.5">
                    <div className="flex items-start gap-3">
                      <div className="w-6 h-6 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <span className="text-xs font-bold text-amber-600">1</span>
                      </div>
                      <p className="text-sm text-slate-600">
                        Share your unique link with friends
                      </p>
                    </div>
                    <div className="flex items-start gap-3">
                      <div className="w-6 h-6 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <span className="text-xs font-bold text-amber-600">2</span>
                      </div>
                      <p className="text-sm text-slate-600">
                        They sign up and create their first trip
                      </p>
                    </div>
                    <div className="flex items-start gap-3">
                      <div className="w-6 h-6 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
                      </div>
                      <p className="text-sm text-slate-600">
                        <strong className="text-slate-900">You both get 1 free AI trip!</strong>
                      </p>
                    </div>
                  </div>
                </div>

                {/* Referral URL */}
                <div className="mb-6">
                  <label className="block text-sm font-semibold text-slate-900 mb-2">
                    Your referral link
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={referralUrl}
                      readOnly
                      className="flex-1 px-4 py-2.5 border border-slate-200 rounded-xl text-sm bg-slate-50 text-slate-600 truncate font-mono"
                    />
                    <button
                      onClick={handleCopy}
                      className={`px-4 py-2.5 rounded-xl text-sm font-medium transition-all flex items-center gap-2 ${
                        copied
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-[var(--primary)] text-white hover:bg-[var(--primary)]/90"
                      }`}
                    >
                      {copied ? (
                        <>
                          <Check className="w-4 h-4" />
                          <span>Copied!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-4 h-4" />
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Share buttons */}
                <div className="mb-6">
                  <label className="block text-sm font-semibold text-slate-900 mb-2">
                    Share via
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      onClick={handleShareTwitter}
                      className="flex items-center justify-center gap-2 px-4 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl transition-colors"
                    >
                      <Twitter className="w-5 h-5" />
                      <span className="text-sm font-medium">Twitter</span>
                    </button>
                    <button
                      onClick={handleShareWhatsApp}
                      className="flex items-center justify-center gap-2 px-4 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl transition-colors"
                    >
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                      </svg>
                      <span className="text-sm font-medium">WhatsApp</span>
                    </button>
                    <button
                      onClick={handleShareEmail}
                      className="flex items-center justify-center gap-2 px-4 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl transition-colors"
                    >
                      <Mail className="w-5 h-5" />
                      <span className="text-sm font-medium">Email</span>
                    </button>
                  </div>
                </div>

                {/* Stats */}
                <div className="border-t border-slate-100 pt-4">
                  <div className="flex items-center justify-center gap-6 text-center">
                    <div>
                      <div className="flex items-center justify-center gap-1.5 text-slate-600 mb-1">
                        <Users className="w-4 h-4" />
                        <span className="text-lg font-bold text-slate-900">{stats.conversions}</span>
                      </div>
                      <p className="text-xs text-slate-500">Friends joined</p>
                    </div>
                    <div className="w-px h-10 bg-slate-200" />
                    <div>
                      <div className="flex items-center justify-center gap-1.5 text-slate-600 mb-1">
                        <Sparkles className="w-4 h-4 text-amber-500" />
                        <span className="text-lg font-bold text-slate-900">{stats.conversions}</span>
                      </div>
                      <p className="text-xs text-slate-500">Trips earned</p>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>

          <style jsx>{`
            @keyframes scale-up {
              from {
                opacity: 0;
                transform: scale(0.95);
              }
              to {
                opacity: 1;
                transform: scale(1);
              }
            }
            .animate-scale-up {
              animation: scale-up 0.2s ease-out;
            }
          `}</style>
        </div>
      </div>
    </div>
  );
}
