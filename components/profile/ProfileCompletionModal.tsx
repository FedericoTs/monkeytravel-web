"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import posthog from "posthog-js";

interface ProfileCompletionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: () => void;
  initialData?: {
    display_name?: string;
    home_country?: string;
    home_city?: string;
    languages?: string[];
    bio?: string;
  };
}

// Common languages for travelers
const LANGUAGES = [
  "English",
  "Spanish",
  "French",
  "German",
  "Italian",
  "Portuguese",
  "Chinese",
  "Japanese",
  "Korean",
  "Arabic",
  "Hindi",
  "Russian",
  "Dutch",
  "Swedish",
  "Greek",
];

// Popular countries with flag emojis
const POPULAR_COUNTRIES = [
  { code: "US", name: "United States", flag: "\u{1F1FA}\u{1F1F8}" },
  { code: "GB", name: "United Kingdom", flag: "\u{1F1EC}\u{1F1E7}" },
  { code: "ES", name: "Spain", flag: "\u{1F1EA}\u{1F1F8}" },
  { code: "FR", name: "France", flag: "\u{1F1EB}\u{1F1F7}" },
  { code: "DE", name: "Germany", flag: "\u{1F1E9}\u{1F1EA}" },
  { code: "IT", name: "Italy", flag: "\u{1F1EE}\u{1F1F9}" },
  { code: "CA", name: "Canada", flag: "\u{1F1E8}\u{1F1E6}" },
  { code: "AU", name: "Australia", flag: "\u{1F1E6}\u{1F1FA}" },
  { code: "BR", name: "Brazil", flag: "\u{1F1E7}\u{1F1F7}" },
  { code: "MX", name: "Mexico", flag: "\u{1F1F2}\u{1F1FD}" },
  { code: "AR", name: "Argentina", flag: "\u{1F1E6}\u{1F1F7}" },
  { code: "NL", name: "Netherlands", flag: "\u{1F1F3}\u{1F1F1}" },
  { code: "PT", name: "Portugal", flag: "\u{1F1F5}\u{1F1F9}" },
  { code: "JP", name: "Japan", flag: "\u{1F1EF}\u{1F1F5}" },
  { code: "IN", name: "India", flag: "\u{1F1EE}\u{1F1F3}" },
];

export default function ProfileCompletionModal({
  isOpen,
  onClose,
  onComplete,
  initialData = {},
}: ProfileCompletionModalProps) {
  const t = useTranslations("common.profileCompletion");
  const tc = useTranslations("common.buttons");

  const [displayName, setDisplayName] = useState(initialData.display_name || "");
  const [homeCountry, setHomeCountry] = useState(initialData.home_country || "");
  const [homeCity, setHomeCity] = useState(initialData.home_city || "");
  const [languages, setLanguages] = useState<string[]>(initialData.languages || []);
  const [bio, setBio] = useState(initialData.bio || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track modal shown event
  useEffect(() => {
    if (isOpen) {
      posthog.capture("profile_modal_shown");
      // Store in session to prevent showing again this session
      sessionStorage.setItem("profile_modal_shown", "true");
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const toggleLanguage = (lang: string) => {
    const langLower = lang.toLowerCase();
    if (languages.includes(langLower)) {
      setLanguages(languages.filter((l) => l !== langLower));
    } else if (languages.length < 5) {
      setLanguages([...languages, langLower]);
    }
  };

  const handleSubmit = async () => {
    if (!displayName.trim()) {
      setError(t("errors.nameRequired"));
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        throw new Error("Not authenticated");
      }

      const { error: updateError } = await supabase
        .from("users")
        .update({
          display_name: displayName.trim(),
          home_country: homeCountry,
          home_city: homeCity,
          languages: languages,
          bio: bio.trim(),
          profile_completed: true,
          profile_completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", user.id);

      if (updateError) throw updateError;

      // Track completion
      posthog.capture("profile_modal_completed", {
        fields_filled: {
          display_name: !!displayName.trim(),
          home_country: !!homeCountry,
          home_city: !!homeCity,
          languages: languages.length,
          bio: !!bio.trim(),
        },
      });

      onComplete();
    } catch (err) {
      console.error("Profile update error:", err);
      setError(t("errors.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const handleSkip = async () => {
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        // Mark as completed even when skipped to not show again
        await supabase
          .from("users")
          .update({
            profile_completed: true,
            profile_completed_at: new Date().toISOString(),
          })
          .eq("id", user.id);
      }
    } catch (err) {
      console.error("Skip error:", err);
    }

    posthog.capture("profile_modal_skipped");
    onClose();
  };

  const handleDismiss = () => {
    posthog.capture("profile_modal_dismissed");
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={saving ? undefined : handleDismiss}
      />

      {/* Modal */}
      <div className="relative bg-white rounded-2xl sm:rounded-3xl w-full max-w-lg p-6 shadow-2xl animate-in slide-in-from-bottom-4 sm:slide-in-from-bottom-0 sm:zoom-in-95 duration-300 max-h-[90vh] overflow-y-auto">
        {/* Header Icon */}
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-br from-[var(--primary)]/20 to-[var(--secondary)]/20 flex items-center justify-center">
          <svg
            className="w-8 h-8 text-[var(--primary)]"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </div>

        <h3 className="text-xl font-bold text-center text-slate-900 mb-2">
          {t("title")}
        </h3>

        <p className="text-slate-600 text-center mb-6">{t("subtitle")}</p>

        {/* Error message */}
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
            {error}
          </div>
        )}

        {/* Form */}
        <div className="space-y-5">
          {/* Display Name */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              {t("fields.displayName")} <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50/50 text-slate-900 placeholder-slate-400 focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 focus:bg-white transition-all outline-none"
              placeholder={t("fields.displayNamePlaceholder")}
              maxLength={50}
              disabled={saving}
            />
          </div>

          {/* Country & City */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                {t("fields.homeCountry")}
              </label>
              <select
                value={homeCountry}
                onChange={(e) => setHomeCountry(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50/50 text-slate-900 focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 focus:bg-white transition-all outline-none appearance-none"
                disabled={saving}
              >
                <option value="">{t("fields.selectCountry")}</option>
                {POPULAR_COUNTRIES.map((country) => (
                  <option key={country.code} value={country.name}>
                    {country.flag} {country.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                {t("fields.homeCity")}
              </label>
              <input
                type="text"
                value={homeCity}
                onChange={(e) => setHomeCity(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50/50 text-slate-900 placeholder-slate-400 focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 focus:bg-white transition-all outline-none"
                placeholder={t("fields.homeCityPlaceholder")}
                maxLength={100}
                disabled={saving}
              />
            </div>
          </div>

          {/* Languages */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              {t("fields.languages")}
            </label>
            <p className="text-xs text-slate-500 mb-3">{t("fields.languagesHint")}</p>
            <div className="flex flex-wrap gap-2">
              {LANGUAGES.map((lang) => {
                const isSelected = languages.includes(lang.toLowerCase());
                return (
                  <button
                    key={lang}
                    type="button"
                    onClick={() => toggleLanguage(lang)}
                    disabled={saving || (!isSelected && languages.length >= 5)}
                    className={`px-3 py-1.5 rounded-full text-sm font-medium border-2 transition-all ${
                      isSelected
                        ? "border-[var(--primary)] bg-[var(--primary)] text-white"
                        : "border-slate-200 text-slate-600 hover:border-[var(--primary)] hover:text-[var(--primary)] disabled:opacity-50 disabled:hover:border-slate-200 disabled:hover:text-slate-600"
                    }`}
                  >
                    {lang}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Bio */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              {t("fields.bio")}
            </label>
            <div className="relative">
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50/50 text-slate-900 placeholder-slate-400 focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 focus:bg-white transition-all outline-none resize-none"
                placeholder={t("fields.bioPlaceholder")}
                rows={3}
                maxLength={200}
                disabled={saving}
              />
              <span className="absolute bottom-2 right-3 text-xs text-slate-400">
                {bio.length}/200
              </span>
            </div>
          </div>
        </div>

        {/* Buttons */}
        <div className="mt-6 flex flex-col gap-3">
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="w-full px-4 py-3 rounded-xl font-medium bg-[var(--primary)] text-white hover:bg-[var(--primary)]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {saving ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
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
                {t("saving")}
              </>
            ) : (
              t("complete")
            )}
          </button>
          <button
            onClick={handleSkip}
            disabled={saving}
            className="w-full px-4 py-3 rounded-xl font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t("skip")}
          </button>
        </div>
      </div>
    </div>
  );
}
