"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Search, X, MapPin, Clock, Loader2, ChevronLeft, AlertCircle } from "lucide-react";
import Image from "next/image";
import type { Activity, ProposalType } from "@/types";
import BaseModal from "@/components/ui/BaseModal";

// Reuse activity search result type
interface ActivitySearchResult {
  id: string;
  name: string;
  type: string;
  description?: string;
  address?: string;
  coordinates?: { lat: number; lng: number };
  duration_minutes?: number;
  estimated_cost?: {
    amount: number;
    currency: string;
    tier: "free" | "budget" | "moderate" | "expensive";
  };
  image_url?: string;
  source: "bank" | "google";
}

interface ProposeActivitySheetProps {
  isOpen: boolean;
  onClose: () => void;
  tripId: string;
  destination: string;
  targetDay: number;
  targetTimeSlot?: 'morning' | 'afternoon' | 'evening';
  /** If provided, this is a replacement proposal for an existing activity */
  targetActivityId?: string;
  targetActivityName?: string;
  onPropose: (input: {
    type: ProposalType;
    activityData: Activity;
    targetActivityId?: string;
    targetDay: number;
    targetTimeSlot?: 'morning' | 'afternoon' | 'evening';
    note?: string;
  }) => Promise<void>;
}

// Activity type categories with icons
const ACTIVITY_CATEGORIES = [
  { type: "restaurant", labelKey: "categories.restaurant", icon: "🍽️" },
  { type: "attraction", labelKey: "categories.attraction", icon: "🏛️" },
  { type: "activity", labelKey: "categories.activity", icon: "🎯" },
  { type: "nature", labelKey: "categories.nature", icon: "🌿" },
  { type: "shopping", labelKey: "categories.shopping", icon: "🛍️" },
];

const TIME_SLOT_CONFIG: Record<string, { labelKey: string; icon: string }> = {
  morning: { labelKey: "timeSlots.morning", icon: "🌅" },
  afternoon: { labelKey: "timeSlots.afternoon", icon: "☀️" },
  evening: { labelKey: "timeSlots.evening", icon: "🌙" },
};

type Step = 'search' | 'custom' | 'preview';

/**
 * ProposeActivitySheet - Modal for proposing new activities
 *
 * Steps:
 * 1. Search/Browse - Find an activity from search or activity bank
 * 2. Custom Form - Create a custom activity (optional path)
 * 3. Preview - Review and add a note before proposing
 */
export function ProposeActivitySheet({
  isOpen,
  onClose,
  tripId: _tripId, // Reserved for future trip-specific validation
  destination,
  targetDay,
  targetTimeSlot,
  targetActivityId,
  targetActivityName,
  onPropose,
}: ProposeActivitySheetProps) {
  const t = useTranslations("common.proposeActivity");

  // Step navigation
  const [step, setStep] = useState<Step>('search');

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [results, setResults] = useState<ActivitySearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Selected activity for preview
  const [selectedActivity, setSelectedActivity] = useState<Partial<Activity> | null>(null);

  // Custom activity form
  const [customActivity, setCustomActivity] = useState({
    name: "",
    type: "activity",
    description: "",
    duration: 90,
  });

  // Proposal note
  const [note, setNote] = useState("");

  // Submission state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Determine proposal type
  const proposalType: ProposalType = targetActivityId ? 'replacement' : 'new';

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setStep('search');
      setSearchQuery("");
      setSelectedCategory(null);
      setResults([]);
      setSelectedActivity(null);
      setCustomActivity({ name: "", type: "activity", description: "", duration: 90 });
      setNote("");
      setError(null);
    }
  }, [isOpen]);

  // Focus input when search step is shown
  useEffect(() => {
    if (isOpen && step === 'search' && inputRef.current) {
      // Delay focus to allow animation
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen, step]);

  // Search activities
  const searchActivities = useCallback(async (query: string, type: string | null) => {
    setIsSearching(true);
    try {
      const response = await fetch("/api/activities/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          destination,
          query,
          types: type ? [type] : [],
          limit: 8,
          includeGoogle: query.length >= 3,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setResults(data.results || []);
      }
    } catch (err) {
      console.error("Activity search error:", err);
    } finally {
      setIsSearching(false);
    }
  }, [destination]);

  // Handle search input
  const handleSearchChange = (value: string) => {
    setSearchQuery(value);

    // Debounce search
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      searchActivities(value, selectedCategory);
    }, 300);
  };

  // Handle category selection
  const handleCategorySelect = (type: string) => {
    const newCategory = selectedCategory === type ? null : type;
    setSelectedCategory(newCategory);
    searchActivities(searchQuery, newCategory);
  };

  // Handle selecting a search result
  const handleSelectResult = (result: ActivitySearchResult) => {
    setSelectedActivity({
      name: result.name,
      type: result.type,
      description: result.description,
      address: result.address,
      coordinates: result.coordinates,
      duration_minutes: result.duration_minutes,
      estimated_cost: result.estimated_cost,
      image_url: result.image_url,
    });
    setStep('preview');
  };

  // Handle custom activity submission
  const handleCustomNext = () => {
    if (!customActivity.name.trim()) return;

    setSelectedActivity({
      name: customActivity.name.trim(),
      type: customActivity.type,
      description: customActivity.description || undefined,
      duration_minutes: customActivity.duration,
    });
    setStep('preview');
  };

  // Handle final proposal submission
  const handleSubmitProposal = async () => {
    if (!selectedActivity || !selectedActivity.name) return;

    setIsSubmitting(true);
    setError(null);

    try {
      await onPropose({
        type: proposalType,
        activityData: {
          id: `proposed-${Date.now()}`,
          name: selectedActivity.name,
          type: selectedActivity.type || 'activity',
          description: selectedActivity.description,
          address: selectedActivity.address,
          coordinates: selectedActivity.coordinates,
          duration_minutes: selectedActivity.duration_minutes || 90,
          estimated_cost: selectedActivity.estimated_cost,
          image_url: selectedActivity.image_url,
          start_time: "09:00", // Will be adjusted by backend
        } as Activity,
        targetActivityId,
        targetDay,
        targetTimeSlot,
        note: note.trim() || undefined,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create proposal");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Load initial suggestions when opened
  useEffect(() => {
    if (isOpen && step === 'search' && results.length === 0 && !searchQuery) {
      searchActivities("", null);
    }
  }, [isOpen, step, results.length, searchQuery, searchActivities]);

  // Navigate back
  const handleBack = () => {
    if (step === 'preview') {
      setStep(customActivity.name ? 'custom' : 'search');
    } else if (step === 'custom') {
      setStep('search');
    }
  };

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      usePortal
      maxWidth="max-w-lg"
      showCloseButton={false}
      animation="slide"
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 bg-slate-50">
        {step !== 'search' && (
          <button
            onClick={handleBack}
            className="p-1.5 hover:bg-slate-200 rounded-lg transition-colors -ml-1"
          >
            <ChevronLeft className="w-5 h-5 text-slate-600" />
          </button>
        )}
        <div className="flex-1">
          <h3 className="font-semibold text-slate-900">
            {proposalType === 'replacement'
              ? t("titleReplacement")
              : t("title")}
          </h3>
          <p className="text-xs text-slate-500">
            {t("day", { day: targetDay })}
            {targetTimeSlot && ` • ${TIME_SLOT_CONFIG[targetTimeSlot].icon} ${t(TIME_SLOT_CONFIG[targetTimeSlot].labelKey)}`}
          </p>
        </div>
        <button
          onClick={onClose}
          className="p-2 hover:bg-slate-200 rounded-lg transition-colors"
        >
          <X className="w-5 h-5 text-slate-500" />
        </button>
      </div>

      {/* Replacement banner */}
      {proposalType === 'replacement' && targetActivityName && (
        <div className="mx-4 mt-4 px-3 py-2 bg-purple-50 border border-purple-200 rounded-lg">
          <p className="text-sm text-purple-700">
            <span className="font-medium">{t("replacing")}:</span> {targetActivityName}
          </p>
        </div>
      )}

      {/* Step Content */}
      <div className="min-h-[300px]">
        {step === 'search' && (
          <div className="p-4 space-y-4">
            {/* Search Input */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                ref={inputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder={t("searchPlaceholder", { destination })}
                className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-lg
                           focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent"
              />
              {isSearching && (
                <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 animate-spin" />
              )}
            </div>

            {/* Category Pills */}
            <div className="flex flex-wrap gap-2">
              {ACTIVITY_CATEGORIES.map((cat) => (
                <button
                  key={cat.type}
                  onClick={() => handleCategorySelect(cat.type)}
                  className={`px-3 py-1.5 text-sm rounded-full transition-colors flex items-center gap-1.5 ${
                    selectedCategory === cat.type
                      ? "bg-[var(--primary)] text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  <span>{cat.icon}</span>
                  <span>{t(cat.labelKey)}</span>
                </button>
              ))}
            </div>

            {/* Results */}
            <div className="max-h-64 overflow-y-auto space-y-2">
              {results.length > 0 ? (
                results.map((result) => (
                  <button
                    key={result.id}
                    onClick={() => handleSelectResult(result)}
                    className="w-full text-left p-3 rounded-lg hover:bg-slate-50
                               transition-colors border border-slate-100 group"
                  >
                    <div className="flex items-start gap-3">
                      {result.image_url ? (
                        <div className="w-12 h-12 rounded-lg overflow-hidden bg-slate-100 flex-shrink-0">
                          <Image
                            src={result.image_url}
                            alt={result.name}
                            width={48}
                            height={48}
                            className="w-full h-full object-cover"
                          />
                        </div>
                      ) : (
                        <div className="w-12 h-12 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                          <MapPin className="w-5 h-5 text-slate-400" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-slate-800 truncate">
                            {result.name}
                          </span>
                          {result.source === "google" && (
                            <span className="px-1.5 py-0.5 text-[10px] bg-blue-100 text-blue-700 rounded">
                              Google
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-500">
                          <span className="capitalize">{result.type}</span>
                          {result.duration_minutes && (
                            <>
                              <span>•</span>
                              <span className="flex items-center gap-0.5">
                                <Clock className="w-3 h-3" />
                                {result.duration_minutes} min
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                ))
              ) : !isSearching && searchQuery.length >= 2 ? (
                <div className="text-center py-6 text-slate-500">
                  <p>{t("noResults", { query: searchQuery })}</p>
                  <button
                    onClick={() => setStep('custom')}
                    className="mt-2 text-[var(--primary)] hover:underline text-sm"
                  >
                    {t("createCustom")}
                  </button>
                </div>
              ) : !isSearching && results.length === 0 ? (
                <div className="text-center py-6 text-slate-400 text-sm">
                  {t("searchHint")}
                </div>
              ) : null}
            </div>

            {/* Add Custom Link */}
            <button
              onClick={() => setStep('custom')}
              className="w-full text-center py-2 text-sm text-[var(--primary)]
                         hover:bg-[var(--primary)]/5 rounded-lg transition-colors"
            >
              + {t("createCustom")}
            </button>
          </div>
        )}

        {step === 'custom' && (
          <div className="p-4 space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                {t("form.nameLabel")} *
              </label>
              <input
                type="text"
                value={customActivity.name}
                onChange={(e) => setCustomActivity({ ...customActivity, name: e.target.value })}
                placeholder={t("form.namePlaceholder")}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg
                           focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent"
                autoFocus
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">{t("form.typeLabel")}</label>
                <select
                  value={customActivity.type}
                  onChange={(e) => setCustomActivity({ ...customActivity, type: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg
                             focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent"
                >
                  <option value="activity">{t("categories.activity")}</option>
                  <option value="restaurant">{t("categories.restaurant")}</option>
                  <option value="attraction">{t("categories.attraction")}</option>
                  <option value="nature">{t("categories.nature")}</option>
                  <option value="shopping">{t("categories.shopping")}</option>
                  <option value="entertainment">{t("categories.entertainment")}</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">{t("form.durationLabel")}</label>
                <select
                  value={customActivity.duration}
                  onChange={(e) => setCustomActivity({ ...customActivity, duration: Number(e.target.value) })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg
                             focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent"
                >
                  <option value={30}>{t("durations.30min")}</option>
                  <option value={60}>{t("durations.1hour")}</option>
                  <option value={90}>{t("durations.1_5hours")}</option>
                  <option value={120}>{t("durations.2hours")}</option>
                  <option value={180}>{t("durations.3hours")}</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                {t("form.descriptionLabel")}
              </label>
              <textarea
                value={customActivity.description}
                onChange={(e) => setCustomActivity({ ...customActivity, description: e.target.value })}
                placeholder={t("form.descriptionPlaceholder")}
                rows={2}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg
                           focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent resize-none"
              />
            </div>

            <button
              onClick={handleCustomNext}
              disabled={!customActivity.name.trim()}
              className="w-full py-2.5 px-4 text-white bg-[var(--primary)]
                         hover:bg-[var(--primary)]/90 rounded-lg transition-colors
                         disabled:opacity-50 disabled:cursor-not-allowed font-medium"
            >
              {t("continue")}
            </button>
          </div>
        )}

        {step === 'preview' && selectedActivity && (
          <div className="p-4 space-y-4">
            {/* Activity Preview Card */}
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              {selectedActivity.image_url && (
                <div className="h-32 bg-slate-100 relative">
                  <Image
                    src={selectedActivity.image_url}
                    alt={selectedActivity.name || "Activity"}
                    fill
                    className="object-cover"
                  />
                </div>
              )}
              <div className="p-4">
                <h4 className="font-semibold text-slate-900">{selectedActivity.name}</h4>
                <div className="flex items-center gap-2 mt-1 text-sm text-slate-500">
                  <span className="capitalize">{selectedActivity.type}</span>
                  {selectedActivity.duration_minutes && (
                    <>
                      <span>•</span>
                      <span>{selectedActivity.duration_minutes} min</span>
                    </>
                  )}
                </div>
                {selectedActivity.description && (
                  <p className="mt-2 text-sm text-slate-600">{selectedActivity.description}</p>
                )}
              </div>
            </div>

            {/* Proposal Note */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                {t("preview.noteLabel")}
              </label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t("preview.notePlaceholder")}
                rows={3}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg
                           focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent resize-none"
              />
              <p className="mt-1 text-xs text-slate-400">
                {t("preview.noteHint")}
              </p>
            </div>

            {/* Error message */}
            {error && (
              <div className="flex items-start gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg">
                <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            {/* Submit Button */}
            <button
              onClick={handleSubmitProposal}
              disabled={isSubmitting}
              className="w-full py-3 px-4 text-white bg-[var(--primary)]
                         hover:bg-[var(--primary)]/90 rounded-lg transition-colors
                         disabled:opacity-50 disabled:cursor-not-allowed font-medium
                         flex items-center justify-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{t("submitting")}</span>
                </>
              ) : (
                <>
                  <span>🗳️</span>
                  <span>{t("submitProposal")}</span>
                </>
              )}
            </button>

            <p className="text-center text-xs text-slate-400">
              {t("voteNotice")}
            </p>
          </div>
        )}
      </div>
    </BaseModal>
  );
}
