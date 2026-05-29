"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Plus, Search, X, MapPin, Clock, Loader2 } from "lucide-react";
import { Activity } from "@/types";
import { ActivitySearchResult } from "@/app/api/activities/search/route";
import { useTranslations } from "next-intl";

interface AddActivityButtonProps {
  dayIndex: number;
  destination: string;
  onAdd: (activity: Partial<Activity>) => void;
  className?: string;
}

// Activity type categories with icons
const ACTIVITY_CATEGORIES = [
  { type: "restaurant", labelKey: "restaurant", icon: "🍽️" },
  { type: "attraction", labelKey: "attraction", icon: "🏛️" },
  { type: "activity", labelKey: "other", icon: "🎯" },
  { type: "nature", labelKey: "park", icon: "🌿" },
  { type: "shopping", labelKey: "shopping", icon: "🛍️" },
];

export default function AddActivityButton({
  dayIndex,
  destination,
  onAdd,
  className = "",
}: AddActivityButtonProps) {
  const t = useTranslations("common.addActivity");
  const tTrip = useTranslations("common.trip");
  const [isExpanded, setIsExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [results, setResults] = useState<ActivitySearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showCustomForm, setShowCustomForm] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  // Mirrors the canonical pattern from DestinationAutocomplete (#160): abort
  // the previous in-flight /api/activities/search when a newer keystroke (or
  // category click, or initial-suggestion fetch) supersedes it. Without this,
  // a slow "Barc" response can land on top of newer "Barcelona" results.
  const abortRef = useRef<AbortController | null>(null);

  // Focus input when expanded
  useEffect(() => {
    if (isExpanded && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isExpanded]);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsExpanded(false);
        setShowCustomForm(false);
      }
    };

    if (isExpanded) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isExpanded]);

  // Search activities. Cancels any prior in-flight request so a stale
  // "Barc" response can't overwrite newer "Barcelona" results — same race
  // shape as DestinationAutocomplete pre-#160. AbortError is the expected
  // path when a newer call supersedes; everything else is logged.
  const searchActivities = useCallback(async (query: string, type: string | null) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

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
        signal: controller.signal,
      });

      if (controller.signal.aborted) return;

      if (response.ok) {
        const data = await response.json();
        if (controller.signal.aborted) return;
        setResults(data.results || []);
      }
    } catch (error) {
      // Newer keystroke aborted this one — drop silently, the newer call
      // owns the UI state now.
      if (error instanceof Error && error.name === "AbortError") return;
      console.error("Activity search error:", error);
    } finally {
      // Only the most recent request should clear the spinner; an aborted
      // older one leaving `isSearching=false` while a newer one is still
      // in flight would flash "no results" between keystrokes.
      if (!controller.signal.aborted) {
        setIsSearching(false);
      }
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
    onAdd({
      name: result.name,
      type: result.type,
      description: result.description,
      address: result.address,
      coordinates: result.coordinates,
      duration_minutes: result.duration_minutes,
      estimated_cost: result.estimated_cost,
      image_url: result.image_url,
    });
    setIsExpanded(false);
    setSearchQuery("");
    setResults([]);
    setSelectedCategory(null);
  };

  // Custom activity form state
  const [customActivity, setCustomActivity] = useState({
    name: "",
    type: "activity",
    description: "",
    duration: 90,
  });

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customActivity.name.trim()) return;

    onAdd({
      name: customActivity.name.trim(),
      type: customActivity.type,
      description: customActivity.description,
      duration_minutes: customActivity.duration,
    });

    setCustomActivity({ name: "", type: "activity", description: "", duration: 90 });
    setShowCustomForm(false);
    setIsExpanded(false);
  };

  // Load initial suggestions when expanded
  useEffect(() => {
    if (isExpanded && results.length === 0 && !searchQuery) {
      searchActivities("", null);
    }
  }, [isExpanded, results.length, searchQuery, searchActivities]);

  // Abort any in-flight request on unmount so a late response can't try to
  // setState on a torn-down component (React warns, and it's a real bug if
  // the user closes the panel mid-search).
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  if (!isExpanded) {
    return (
      <button
        onClick={() => setIsExpanded(true)}
        className={`group flex items-center gap-2 w-full py-3 px-4 border-2 border-dashed border-slate-200 rounded-xl text-slate-500 hover:border-[var(--primary)] hover:text-[var(--primary)] hover:bg-[var(--primary)]/5 transition-all ${className}`}
      >
        <Plus className="w-5 h-5 transition-transform group-hover:rotate-90" />
        <span className="font-medium">{t("title")}</span>
      </button>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden ${className}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50">
        <span className="font-medium text-slate-700">{t("title")} - {tTrip("dayLabel", { number: dayIndex + 1 })}</span>
        <button
          onClick={() => {
            setIsExpanded(false);
            setShowCustomForm(false);
          }}
          className="p-1 hover:bg-slate-200 rounded-lg transition-colors"
        >
          <X className="w-4 h-4 text-slate-500" />
        </button>
      </div>

      {showCustomForm ? (
        /* Custom Activity Form */
        <form onSubmit={handleCustomSubmit} className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              {t("activityNameRequired")}
            </label>
            <input
              type="text"
              value={customActivity.name}
              onChange={(e) => setCustomActivity({ ...customActivity, name: e.target.value })}
              placeholder={t("activityPlaceholder")}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">{t("type")}</label>
              <select
                value={customActivity.type}
                onChange={(e) => setCustomActivity({ ...customActivity, type: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent"
              >
                <option value="activity">{t("categories.activity")}</option>
                <option value="restaurant">{t("categories.restaurant")}</option>
                <option value="attraction">{t("categories.attraction")}</option>
                <option value="nature">{t("categories.nature")}</option>
                <option value="shopping">{t("categories.shopping")}</option>
                <option value="entertainment">{t("categories.entertainment")}</option>
                <option value="transport">{t("categories.transport")}</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">{t("duration")}</label>
              <select
                value={customActivity.duration}
                onChange={(e) => setCustomActivity({ ...customActivity, duration: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent"
              >
                <option value={30}>{t("durations.30min")}</option>
                <option value={60}>{t("durations.1hr")}</option>
                <option value={90}>{t("durations.90min")}</option>
                <option value={120}>{t("durations.2hr")}</option>
                <option value={180}>{t("durations.3hr")}</option>
                <option value={240}>{t("durations.4hr")}</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              {t("descriptionOptional")}
            </label>
            <textarea
              value={customActivity.description}
              onChange={(e) => setCustomActivity({ ...customActivity, description: e.target.value })}
              placeholder={t("descriptionPlaceholder")}
              rows={2}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent resize-none"
            />
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setShowCustomForm(false)}
              className="flex-1 py-2 px-4 text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
            >
              {t("back")}
            </button>
            <button
              type="submit"
              disabled={!customActivity.name.trim()}
              className="flex-1 py-2 px-4 text-white bg-[var(--primary)] hover:bg-[var(--primary)]/90 rounded-lg transition-colors disabled:opacity-50"
            >
              {t("add")}
            </button>
          </div>
        </form>
      ) : (
        /* Search Interface */
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
              className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent"
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
                <span>{t(`categories.${cat.labelKey}`)}</span>
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
                  className="w-full text-left p-3 rounded-lg hover:bg-slate-50 transition-colors border border-slate-100 group"
                >
                  <div className="flex items-start gap-3">
                    {result.image_url ? (
                      <img
                        src={result.image_url}
                        alt={result.name}
                        className="w-12 h-12 rounded-lg object-cover flex-shrink-0"
                      />
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
                      {result.address && (
                        <p className="text-xs text-slate-500 mt-1 line-clamp-1 flex items-center gap-1">
                          <MapPin className="w-3 h-3 flex-shrink-0" />
                          {result.address}
                        </p>
                      )}
                    </div>
                    <Plus className="w-5 h-5 text-slate-300 group-hover:text-[var(--primary)] transition-colors flex-shrink-0" />
                  </div>
                </button>
              ))
            ) : !isSearching && searchQuery.length >= 2 ? (
              <div className="text-center py-6 text-slate-500">
                <p>{t("noResults", { query: searchQuery })}</p>
                <button
                  onClick={() => setShowCustomForm(true)}
                  className="mt-2 text-[var(--primary)] hover:underline text-sm"
                >
                  {t("addManually")}
                </button>
              </div>
            ) : !isSearching && results.length === 0 ? (
              <div className="text-center py-6 text-slate-400 text-sm">
                {t("searchOrSelect")}
              </div>
            ) : null}
          </div>

          {/* Add Custom Link */}
          <button
            onClick={() => setShowCustomForm(true)}
            className="w-full text-center py-2 text-sm text-[var(--primary)] hover:bg-[var(--primary)]/5 rounded-lg transition-colors"
          >
            + {t("addCustom")}
          </button>
        </div>
      )}
    </div>
  );
}
