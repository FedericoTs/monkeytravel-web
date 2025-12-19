"use client";

import { useState, useEffect, useCallback, useRef } from "react";

// ============================================================================
// Types
// ============================================================================

export interface UseFetchOptions<T> {
  /** Whether to fetch immediately on mount (default: true) */
  immediate?: boolean;
  /** Initial data value */
  initialData?: T;
  /** Transform response data before setting state */
  transform?: (data: unknown) => T;
  /** Dependencies to trigger refetch */
  deps?: unknown[];
  /** Callback on successful fetch */
  onSuccess?: (data: T) => void;
  /** Callback on error */
  onError?: (error: Error) => void;
  /** Request options to pass to fetch */
  fetchOptions?: RequestInit;
  /** Debounce delay in ms (useful for search inputs) */
  debounce?: number;
}

export interface UseFetchReturn<T> {
  /** The fetched data */
  data: T | null;
  /** Whether a fetch is in progress */
  isLoading: boolean;
  /** Error message if fetch failed */
  error: string | null;
  /** Manually trigger a fetch */
  refetch: () => Promise<void>;
  /** Reset state to initial values */
  reset: () => void;
  /** Set data manually (useful for optimistic updates) */
  setData: React.Dispatch<React.SetStateAction<T | null>>;
}

export interface UseMutationOptions<T, V> {
  /** Callback on successful mutation */
  onSuccess?: (data: T) => void;
  /** Callback on error */
  onError?: (error: Error) => void;
  /** Transform response data */
  transform?: (data: unknown) => T;
}

export interface UseMutationReturn<T, V> {
  /** The response data from the last mutation */
  data: T | null;
  /** Whether a mutation is in progress */
  isLoading: boolean;
  /** Error message if mutation failed */
  error: string | null;
  /** Trigger the mutation */
  mutate: (variables: V) => Promise<T | null>;
  /** Reset state */
  reset: () => void;
}

// ============================================================================
// useFetch Hook
// ============================================================================

/**
 * Hook for fetching data from an API endpoint
 *
 * @example
 * // Basic usage
 * const { data, isLoading, error } = useFetch<User[]>("/api/users");
 *
 * @example
 * // With options
 * const { data, refetch } = useFetch<Trip>(`/api/trips/${id}`, {
 *   immediate: Boolean(id),
 *   deps: [id],
 *   onSuccess: (trip) => console.log("Loaded trip:", trip.name),
 * });
 *
 * @example
 * // With transform
 * const { data } = useFetch<ActivityTimeline[]>(`/api/trips/${id}/activities`, {
 *   transform: (res: { timelines: ActivityTimeline[] }) => res.timelines,
 * });
 */
export function useFetch<T>(
  url: string | null,
  options: UseFetchOptions<T> = {}
): UseFetchReturn<T> {
  const {
    immediate = true,
    initialData = null,
    transform,
    deps = [],
    onSuccess,
    onError,
    fetchOptions,
    debounce = 0,
  } = options;

  const [data, setData] = useState<T | null>(initialData);
  const [isLoading, setIsLoading] = useState(immediate && Boolean(url));
  const [error, setError] = useState<string | null>(null);

  // Track if component is mounted to prevent state updates after unmount
  const isMounted = useRef(true);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, []);

  const fetchData = useCallback(async () => {
    if (!url) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(url, fetchOptions);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Request failed with status ${response.status}`);
      }

      const rawData = await response.json();
      const processedData = transform ? transform(rawData) : (rawData as T);

      if (isMounted.current) {
        setData(processedData);
        onSuccess?.(processedData);
      }
    } catch (err) {
      if (isMounted.current) {
        const errorMessage = err instanceof Error ? err.message : "An error occurred";
        setError(errorMessage);
        onError?.(err instanceof Error ? err : new Error(errorMessage));
      }
    } finally {
      if (isMounted.current) {
        setIsLoading(false);
      }
    }
  }, [url, fetchOptions, transform, onSuccess, onError]);

  // Debounced fetch
  const debouncedFetch = useCallback(() => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }

    if (debounce > 0) {
      debounceTimer.current = setTimeout(fetchData, debounce);
    } else {
      fetchData();
    }
  }, [fetchData, debounce]);

  // Initial fetch and refetch on deps change
  useEffect(() => {
    if (immediate && url) {
      debouncedFetch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, immediate, ...deps]);

  const reset = useCallback(() => {
    setData(initialData);
    setError(null);
    setIsLoading(false);
  }, [initialData]);

  return {
    data,
    isLoading,
    error,
    refetch: fetchData,
    reset,
    setData,
  };
}

// ============================================================================
// useMutation Hook
// ============================================================================

/**
 * Hook for making mutations (POST, PUT, PATCH, DELETE)
 *
 * @example
 * const { mutate, isLoading } = useMutation<Trip, CreateTripData>(
 *   "/api/trips",
 *   "POST"
 * );
 *
 * const handleSubmit = async () => {
 *   const trip = await mutate({ name: "My Trip", destination: "Paris" });
 *   if (trip) router.push(`/trips/${trip.id}`);
 * };
 *
 * @example
 * // With callbacks
 * const { mutate } = useMutation<void, { id: string }>(
 *   "/api/trips",
 *   "DELETE",
 *   {
 *     onSuccess: () => toast.success("Trip deleted"),
 *     onError: (err) => toast.error(err.message),
 *   }
 * );
 */
export function useMutation<T, V = unknown>(
  url: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE" = "POST",
  options: UseMutationOptions<T, V> = {}
): UseMutationReturn<T, V> {
  const { onSuccess, onError, transform } = options;

  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  const mutate = useCallback(
    async (variables: V): Promise<T | null> => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch(url, {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(variables),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || `Request failed with status ${response.status}`);
        }

        const rawData = await response.json();
        const processedData = transform ? transform(rawData) : (rawData as T);

        if (isMounted.current) {
          setData(processedData);
          onSuccess?.(processedData);
        }

        return processedData;
      } catch (err) {
        if (isMounted.current) {
          const errorMessage = err instanceof Error ? err.message : "An error occurred";
          setError(errorMessage);
          onError?.(err instanceof Error ? err : new Error(errorMessage));
        }
        return null;
      } finally {
        if (isMounted.current) {
          setIsLoading(false);
        }
      }
    },
    [url, method, transform, onSuccess, onError]
  );

  const reset = useCallback(() => {
    setData(null);
    setError(null);
    setIsLoading(false);
  }, []);

  return {
    data,
    isLoading,
    error,
    mutate,
    reset,
  };
}

// ============================================================================
// Utility Types for API Responses
// ============================================================================

/** Standard paginated response */
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

/** Standard success response with metadata */
export interface ApiResponse<T> {
  success: boolean;
  data: T;
  meta?: Record<string, unknown>;
}

export default useFetch;
