"use client";

/**
 * DestinationAutocomplete Component
 *
 * Premium autocomplete input for travel destinations.
 * Uses local database first for popular destinations (FREE),
 * falls back to Google Places API only when absolutely necessary.
 *
 * Features:
 * - Popular destinations shown on focus (0 API calls)
 * - Local-first search (190+ popular destinations, $0 cost)
 * - Client-side caching to avoid repeat searches
 * - Minimum 3 characters to trigger search (reduces API calls)
 * - Debounced search (300ms)
 * - Keyboard navigation (↑↓ Enter Esc)
 * - Country flags and structured display
 * - Smooth animations
 * - Mobile-friendly touch targets
 * - Loading and empty states
 */

import { useState, useEffect, useRef, useCallback, KeyboardEvent } from "react";
import { useTranslations } from "next-intl";
import { useDebounce } from "@/hooks/useDebounce";
import type { PlacePrediction } from "@/types";

// Helper to normalize destination names for deduplication
function normalizeForDedup(mainText: string, secondaryText: string): string {
  return `${mainText.toLowerCase().trim()}|${secondaryText.toLowerCase().trim()}`;
}

// Deduplicate predictions by normalized name, preferring local results
function deduplicatePredictions(predictions: PlacePrediction[]): PlacePrediction[] {
  const seen = new Map<string, PlacePrediction>();
  for (const pred of predictions) {
    const key = normalizeForDedup(pred.mainText, pred.secondaryText);
    const existing = seen.get(key);
    // Prefer local/popular over google (has coordinates, no API cost)
    if (!existing || (existing.source === "google" && pred.source !== "google")) {
      seen.set(key, pred);
    }
  }
  return Array.from(seen.values());
}

// Fallback popular destinations (used while loading from API)
const FALLBACK_POPULAR: PlacePrediction[] = [
  { placeId: "popular_paris", mainText: "Paris", secondaryText: "France", fullText: "Paris, France", countryCode: "FR", flag: "🇫🇷", types: ["(cities)"], coordinates: { latitude: 48.8566, longitude: 2.3522 }, source: "local" },
  { placeId: "popular_tokyo", mainText: "Tokyo", secondaryText: "Japan", fullText: "Tokyo, Japan", countryCode: "JP", flag: "🇯🇵", types: ["(cities)"], coordinates: { latitude: 35.6762, longitude: 139.6503 }, source: "local" },
  { placeId: "popular_nyc", mainText: "New York City", secondaryText: "United States", fullText: "New York City, United States", countryCode: "US", flag: "🇺🇸", types: ["(cities)"], coordinates: { latitude: 40.7128, longitude: -74.0060 }, source: "local" },
  { placeId: "popular_london", mainText: "London", secondaryText: "United Kingdom", fullText: "London, United Kingdom", countryCode: "GB", flag: "🇬🇧", types: ["(cities)"], coordinates: { latitude: 51.5074, longitude: -0.1278 }, source: "local" },
];

// Module-level cache for popular destinations from API
let popularDestinationsCache: PlacePrediction[] | null = null;
let popularFetchPromise: Promise<PlacePrediction[]> | null = null;

async function fetchPopularDestinations(): Promise<PlacePrediction[]> {
  // Return cached if available
  if (popularDestinationsCache) {
    return popularDestinationsCache;
  }

  // Return existing promise if already fetching
  if (popularFetchPromise) {
    return popularFetchPromise;
  }

  // Start fetch
  popularFetchPromise = fetch("/api/destinations/popular?limit=8")
    .then(res => res.json())
    .then(data => {
      const predictions = (data.predictions || []) as PlacePrediction[];
      popularDestinationsCache = predictions.length > 0 ? predictions : FALLBACK_POPULAR;
      return popularDestinationsCache;
    })
    .catch(err => {
      console.error("Failed to fetch popular destinations:", err);
      return FALLBACK_POPULAR;
    })
    .finally(() => {
      popularFetchPromise = null;
    });

  return popularFetchPromise;
}

// Client-side search cache (5 minute TTL)
const searchCache = new Map<string, { results: PlacePrediction[]; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCachedResults(query: string): PlacePrediction[] | null {
  const cached = searchCache.get(query.toLowerCase());
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.results;
  }
  return null;
}

function setCachedResults(query: string, results: PlacePrediction[]) {
  // Limit cache size to prevent memory issues
  if (searchCache.size > 100) {
    const oldestKey = searchCache.keys().next().value;
    if (oldestKey) searchCache.delete(oldestKey);
  }
  searchCache.set(query.toLowerCase(), { results, timestamp: Date.now() });
}

// Re-export PlacePrediction for components importing from this file
export type { PlacePrediction } from "@/types";

interface DestinationAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  onSelect?: (prediction: PlacePrediction) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}

export default function DestinationAutocomplete({
  value,
  onChange,
  onSelect,
  placeholder,
  className = "",
  autoFocus = false,
}: DestinationAutocompleteProps) {
  const t = useTranslations("common.destinationSearch");
  const [predictions, setPredictions] = useState<PlacePrediction[]>([]);
  const [popularDestinations, setPopularDestinations] = useState<PlacePrediction[]>(FALLBACK_POPULAR);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [searchSource, setSearchSource] = useState<"local" | "popular">("local");
  const [showPopular, setShowPopular] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const isSelectingRef = useRef(false); // Prevent double-click selection
  const justSelectedRef = useRef(false); // Prevent search after selection

  // Increased debounce to 300ms to reduce API calls
  const debouncedValue = useDebounce(value, 300);

  // Fetch popular destinations on mount (from database)
  useEffect(() => {
    fetchPopularDestinations().then(setPopularDestinations);
  }, []);

  // Search local destinations first, then optionally fall back to Google
  const searchLocal = useCallback(async (input: string): Promise<PlacePrediction[]> => {
    try {
      const response = await fetch("/api/destinations/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input, limit: 8 }),
      });
      const data = await response.json();
      return (data.predictions || []).map((p: PlacePrediction) => ({
        ...p,
        source: "local" as const,
      }));
    } catch (error) {
      console.error("Local search error:", error);
      return [];
    }
  }, []);

  // Google Places API removed - we now use local-only search to minimize costs
  // If a destination isn't in our database, users can still type it manually

  // Fetch predictions when debounced value changes - LOCAL FIRST, with caching
  useEffect(() => {
    const fetchPredictions = async () => {
      // Skip searching if we just made a selection (prevents dropdown re-appearing)
      if (justSelectedRef.current) {
        console.log("[Autocomplete] Skipping search - just selected");
        return;
      }

      // Show popular destinations when input is empty or very short
      if (!debouncedValue || debouncedValue.length < 3) {
        if (showPopular && debouncedValue.length < 3) {
          // Show popular destinations (from database, no Google API call)
          setPredictions(popularDestinations);
          setSearchSource("popular");
          setIsOpen(true);
          setHighlightedIndex(-1);
        } else {
          setPredictions([]);
          setIsOpen(false);
        }
        return;
      }

      // Check client-side cache first
      const cachedResults = getCachedResults(debouncedValue);
      if (cachedResults) {
        console.log("[Autocomplete] Using cached results for:", debouncedValue);
        setPredictions(cachedResults);
        setSearchSource("local");
        setIsOpen(cachedResults.length > 0);
        setHighlightedIndex(-1);
        return;
      }

      setIsLoading(true);

      try {
        // LOCAL ONLY - no Google API calls to minimize costs
        const localResults = await searchLocal(debouncedValue);

        if (localResults.length > 0) {
          // Found local results - use them and cache
          setPredictions(localResults);
          setSearchSource("local");
          setCachedResults(debouncedValue, localResults);
          setIsOpen(true);
          setHighlightedIndex(-1);
        } else {
          // No local results - show empty state with helpful message
          // User can still manually type any destination
          setPredictions([]);
          setSearchSource("local");
          setIsOpen(true); // Keep open to show "no results" message
          setHighlightedIndex(-1);
        }
      } catch (error) {
        console.error("Autocomplete fetch error:", error);
        setPredictions([]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchPredictions();
  }, [debouncedValue, searchLocal, showPopular, popularDestinations]);


  // Handle selection - use local coordinates directly (no API calls)
  const handleSelect = useCallback(
    (prediction: PlacePrediction) => {
      // Prevent double-click/rapid selection
      if (isSelectingRef.current) {
        console.log("[Autocomplete] Selection already in progress, ignoring");
        return;
      }
      isSelectingRef.current = true;
      justSelectedRef.current = true; // Prevent useEffect from re-searching

      // Immediately close dropdown and update input
      onChange(prediction.fullText);
      setIsOpen(false);
      setPredictions([]);
      setShowPopular(false);
      inputRef.current?.blur();

      // All our results are local with coordinates - no API calls needed
      console.log("[Autocomplete] Using local coordinates - $0 cost");
      onSelect?.(prediction);

      // Reset selection locks after a short delay
      setTimeout(() => {
        isSelectingRef.current = false;
      }, 300);

      // Reset justSelected after debounce period passes (prevents re-search)
      setTimeout(() => {
        justSelectedRef.current = false;
      }, 500);
    },
    [onChange, onSelect]
  );

  // Keyboard navigation
  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen || predictions.length === 0) {
      if (e.key === "Escape") {
        inputRef.current?.blur();
      }
      return;
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setHighlightedIndex((prev) =>
          prev < predictions.length - 1 ? prev + 1 : 0
        );
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlightedIndex((prev) =>
          prev > 0 ? prev - 1 : predictions.length - 1
        );
        break;
      case "Enter":
        e.preventDefault();
        if (highlightedIndex >= 0 && predictions[highlightedIndex]) {
          handleSelect(predictions[highlightedIndex]);
        }
        break;
      case "Escape":
        e.preventDefault();
        setIsOpen(false);
        setHighlightedIndex(-1);
        break;
      case "Tab":
        setIsOpen(false);
        break;
    }
  };

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightedIndex >= 0 && itemRefs.current[highlightedIndex]) {
      itemRefs.current[highlightedIndex]?.scrollIntoView({
        block: "nearest",
      });
    }
  }, [highlightedIndex]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Clear input
  const handleClear = () => {
    onChange("");
    // Show popular destinations after clearing
    setPredictions(popularDestinations);
    setSearchSource("popular");
    setShowPopular(true);
    setIsOpen(true);
    inputRef.current?.focus();
  };

  return (
    <div className={`relative ${className}`}>
      {/* Input Container */}
      <div className="relative">
        {/* Search Icon */}
        <div className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none">
          {isLoading ? (
            <div className="w-5 h-5 border-2 border-[var(--primary)]/30 border-t-[var(--primary)] rounded-full animate-spin" />
          ) : (
            <svg
              className="w-5 h-5 text-slate-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          )}
        </div>

        {/* Input Field */}
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            // Show popular destinations when focusing on empty input
            if (!value || value.length < 3) {
              setShowPopular(true);
              setPredictions(popularDestinations);
              setSearchSource("popular");
              setIsOpen(true);
            } else if (predictions.length > 0) {
              setIsOpen(true);
            }
          }}
          placeholder={placeholder || t("placeholder")}
          autoFocus={autoFocus}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck="false"
          className="w-full pl-12 pr-12 py-4 text-lg rounded-xl border border-slate-300 bg-white
                     focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20
                     outline-none transition-all duration-200
                     placeholder:text-slate-400"
        />

        {/* Clear Button */}
        {value && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-4 top-1/2 -translate-y-1/2 p-1 rounded-full
                       text-slate-400 hover:text-slate-600 hover:bg-slate-100
                       transition-colors"
            aria-label={t("clearInput")}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        )}
      </div>

      {/* Dropdown */}
      {isOpen && predictions.length > 0 && (
        <div
          ref={dropdownRef}
          className="absolute z-50 w-full mt-2 bg-white rounded-xl border border-slate-200
                     shadow-xl shadow-slate-200/50 overflow-hidden
                     animate-in fade-in slide-in-from-top-2 duration-150"
        >
          <div className="max-h-[320px] overflow-y-auto overscroll-contain">
            {predictions.map((prediction, index) => (
              <button
                key={prediction.placeId}
                ref={(el) => {
                  itemRefs.current[index] = el;
                }}
                type="button"
                onClick={() => handleSelect(prediction)}
                onMouseEnter={() => setHighlightedIndex(index)}
                className={`w-full px-4 py-3.5 flex items-center gap-3 text-left
                           transition-colors duration-100
                           ${
                             highlightedIndex === index
                               ? "bg-[var(--primary)]/5"
                               : "hover:bg-slate-50"
                           }`}
              >
                {/* Flag */}
                <span className="text-2xl flex-shrink-0" role="img" aria-label="Country flag">
                  {prediction.flag}
                </span>

                {/* Text Content */}
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-slate-900 truncate">
                    {prediction.mainText}
                  </div>
                  {prediction.secondaryText && (
                    <div className="text-sm text-slate-500 truncate">
                      {prediction.secondaryText}
                    </div>
                  )}
                </div>

                {/* City Badge */}
                <span className="flex-shrink-0 px-2 py-0.5 rounded-full bg-slate-100 text-xs font-medium text-slate-500">
                  {t("cityBadge")}
                </span>
              </button>
            ))}
          </div>

          {/* Footer with source attribution */}
          <div className="px-4 py-2 border-t border-slate-100 bg-slate-50/50">
            {searchSource === "popular" ? (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs text-slate-400">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                  </svg>
                  <span>{t("popularDestinations")}</span>
                </div>
                <span className="text-[10px] text-slate-400">{t("typeToSearch")}</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-xs text-slate-400">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>{t("fromCuratedList")}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* No Results State */}
      {isOpen && !isLoading && predictions.length === 0 && debouncedValue.length >= 3 && (
        <div
          className="absolute z-50 w-full mt-2 bg-white rounded-xl border border-slate-200
                     shadow-xl shadow-slate-200/50 overflow-hidden p-5 text-center
                     animate-in fade-in slide-in-from-top-2 duration-150"
        >
          <div className="text-slate-400 mb-2">
            <svg
              className="w-8 h-8 mx-auto opacity-50"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <p className="text-slate-600 font-medium">{t("notInListYet")}</p>
          <p className="text-sm text-slate-400 mt-1">
            {t("typeAndEnter")}
          </p>
        </div>
      )}
    </div>
  );
}
