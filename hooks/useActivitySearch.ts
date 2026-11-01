import { useCallback, useEffect, useRef, useState } from "react";
import type { ActivitySearchResult } from "@/app/api/activities/search/route";

export type { ActivitySearchResult };

/**
 * Activity search for the add-activity panel and the propose sheet.
 *
 * A typed query searches after a 300ms pause and a category searches at once.
 * A newer search cancels the one in flight, so a slow "Barc" answer can't
 * replace newer "Barcelona" results (or download their paid photos). While
 * `suggest` is true and nothing is typed or found yet, it loads suggestions.
 */
export function useActivitySearch(destination: string, suggest: boolean) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [results, setResults] = useState<ActivitySearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [resets, setResets] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const search = useCallback(
    async (text: string, type: string | null) => {
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
            query: text,
            types: type ? [type] : [],
            limit: 8,
            includeGoogle: text.length >= 3,
          }),
          signal: controller.signal,
        });
        if (response.ok) {
          const data = await response.json();
          if (controller.signal.aborted) return;
          setResults(data.results || []);
        }
      } catch (error) {
        // A newer search aborted this one and owns the results now.
        if (error instanceof Error && error.name === "AbortError") return;
        console.error("Activity search error:", error);
      } finally {
        // Only the latest search clears the spinner; an aborted older one
        // would flash "no results" while the newer one is still loading.
        if (!controller.signal.aborted) setIsSearching(false);
      }
    },
    [destination]
  );

  const changeQuery = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(value, category), 300);
  };

  const toggleCategory = (type: string) => {
    const next = category === type ? null : type;
    setCategory(next);
    search(query, next);
  };

  /** Back to an empty search (and fresh suggestions); anything pending is cancelled. */
  const reset = useCallback(() => {
    abortRef.current?.abort();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setQuery("");
    setCategory(null);
    setResults([]);
    setIsSearching(false);
    setResets((n) => n + 1);
  }, []);

  // `resets` re-runs this after a reset even when nothing else changed: the
  // reset may have cancelled the suggestions it had just asked for.
  useEffect(() => {
    if (suggest && results.length === 0 && !query) search("", null);
  }, [suggest, results.length, query, search, resets]);

  // Nothing may land, or start, after the panel is gone.
  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    []
  );

  return { query, category, results, isSearching, changeQuery, toggleCategory, reset };
}
