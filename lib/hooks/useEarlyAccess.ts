"use client";

import { useState, useCallback, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

export interface EarlyAccessLimits {
  generations: { limit: number | null; used: number };
  regenerations: { limit: number | null; used: number };
  assistant: { limit: number | null; used: number };
}

export interface EarlyAccessStatus {
  hasAccess: boolean;
  isAdmin: boolean;
  accessType: "admin" | "tester" | "none";
  codeUsed?: string;
  limits?: EarlyAccessLimits;
  expiresAt?: string | null;
  redeemedAt?: string;
}

interface UseEarlyAccessReturn {
  status: EarlyAccessStatus | null;
  isLoading: boolean;
  error: string | null;
  hasAccess: boolean;
  showModal: boolean;
  setShowModal: (show: boolean) => void;
  redeemCode: (code: string) => Promise<boolean>;
  checkAndGate: () => boolean;
  refresh: () => Promise<void>;
}

/**
 * Hook to manage early access state and gate AI features
 */
export function useEarlyAccess(): UseEarlyAccessReturn {
  const [status, setStatus] = useState<EarlyAccessStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // Fetch early access status
  const fetchStatus = useCallback(async () => {
    try {
      setError(null);

      // Check if user is authenticated first
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        setIsAuthenticated(false);
        setStatus({ hasAccess: false, isAdmin: false, accessType: "none" });
        setIsLoading(false);
        return;
      }

      setIsAuthenticated(true);

      const response = await fetch("/api/early-access/status");

      if (!response.ok) {
        throw new Error("Failed to fetch early access status");
      }

      const data: EarlyAccessStatus = await response.json();
      setStatus(data);
    } catch (err) {
      console.error("Error fetching early access status:", err);
      setError(err instanceof Error ? err.message : "Failed to check access");
      // Default to no access on error
      setStatus({ hasAccess: false, isAdmin: false, accessType: "none" });
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initial fetch and auth state listener
  useEffect(() => {
    fetchStatus();

    const supabase = createClient();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT") {
        fetchStatus();
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [fetchStatus]);

  // Redeem a code
  const redeemCode = useCallback(async (code: string): Promise<boolean> => {
    try {
      setError(null);

      const response = await fetch("/api/early-access/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Failed to redeem code");
        return false;
      }

      // Update status with new access
      if (data.access) {
        setStatus(data.access);
      }

      setShowModal(false);
      return true;
    } catch (err) {
      console.error("Error redeeming code:", err);
      setError(err instanceof Error ? err.message : "Failed to redeem code");
      return false;
    }
  }, []);

  // Check access and show modal if needed
  // Returns true if user has access, false if modal was shown
  const checkAndGate = useCallback((): boolean => {
    if (!isAuthenticated) {
      // User needs to log in first - redirect to login
      window.location.href = "/auth/login?redirect=" + encodeURIComponent(window.location.pathname);
      return false;
    }

    if (status?.hasAccess) {
      return true;
    }

    // Show the early access modal
    setShowModal(true);
    return false;
  }, [isAuthenticated, status]);

  return {
    status,
    isLoading,
    error,
    hasAccess: status?.hasAccess ?? false,
    showModal,
    setShowModal,
    redeemCode,
    checkAndGate,
    refresh: fetchStatus,
  };
}

/**
 * Get remaining uses for a specific action type
 */
export function getRemainingUses(
  limits: EarlyAccessLimits | undefined,
  action: "generation" | "regeneration" | "assistant"
): number | null {
  if (!limits) return null;

  const mapping = {
    generation: limits.generations,
    regeneration: limits.regenerations,
    assistant: limits.assistant,
  };

  const actionLimits = mapping[action];
  if (!actionLimits || actionLimits.limit === null) return null;

  return Math.max(0, actionLimits.limit - actionLimits.used);
}
