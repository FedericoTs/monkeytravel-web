"use client";

/**
 * DestinationAutocomplete Component
 *
 * Premium autocomplete input for travel destinations.
 * Uses Google Places Autocomplete (New) API.
 *
 * Features:
 * - Debounced search (250ms)
 * - Keyboard navigation (↑↓ Enter Esc)
 * - Country flags and structured display
 * - Smooth animations
 * - Mobile-friendly touch targets
 * - Loading and empty states
 */

import { useState, useEffect, useRef, useCallback, KeyboardEvent } from "react";
import { useDebounce } from "@/hooks/useDebounce";

export interface PlacePrediction {
  placeId: string;
  mainText: string;
  secondaryText: string;
  fullText: string;
  countryCode: string | null;
  flag: string;
  types: string[];
}

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
  placeholder = "Search destinations...",
  className = "",
  autoFocus = false,
}: DestinationAutocompleteProps) {
  const [predictions, setPredictions] = useState<PlacePrediction[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [sessionToken] = useState(() => crypto.randomUUID());

  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const debouncedValue = useDebounce(value, 250);

  // Fetch predictions when debounced value changes
  useEffect(() => {
    const fetchPredictions = async () => {
      if (!debouncedValue || debouncedValue.length < 2) {
        setPredictions([]);
        setIsOpen(false);
        return;
      }

      setIsLoading(true);

      try {
        const response = await fetch("/api/places/autocomplete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            input: debouncedValue,
            sessionToken,
          }),
        });

        const data = await response.json();

        if (data.predictions) {
          setPredictions(data.predictions);
          setIsOpen(data.predictions.length > 0);
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
  }, [debouncedValue, sessionToken]);

  // Handle selection
  const handleSelect = useCallback(
    (prediction: PlacePrediction) => {
      onChange(prediction.fullText);
      onSelect?.(prediction);
      setIsOpen(false);
      setPredictions([]);
      inputRef.current?.blur();
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
    setPredictions([]);
    setIsOpen(false);
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
            if (predictions.length > 0) setIsOpen(true);
          }}
          placeholder={placeholder}
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
            aria-label="Clear input"
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
                  City
                </span>
              </button>
            ))}
          </div>

          {/* Powered by Google Attribution */}
          <div className="px-4 py-2 border-t border-slate-100 bg-slate-50/50">
            <div className="flex items-center gap-1.5 text-xs text-slate-400">
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24">
                <path
                  fill="currentColor"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="currentColor"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="currentColor"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="currentColor"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              <span>Powered by Google</span>
            </div>
          </div>
        </div>
      )}

      {/* No Results State */}
      {isOpen && !isLoading && predictions.length === 0 && debouncedValue.length >= 2 && (
        <div
          className="absolute z-50 w-full mt-2 bg-white rounded-xl border border-slate-200
                     shadow-xl shadow-slate-200/50 overflow-hidden p-6 text-center
                     animate-in fade-in slide-in-from-top-2 duration-150"
        >
          <div className="text-slate-400 mb-2">
            <svg
              className="w-10 h-10 mx-auto opacity-50"
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
          <p className="text-slate-500 font-medium">No destinations found</p>
          <p className="text-sm text-slate-400 mt-1">Try a different search term</p>
        </div>
      )}
    </div>
  );
}
