"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/auth/AuthProvider";
import {
  AccessLevel,
  getUserAccessLevel,
  getTrialDaysRemaining,
  hasFullAccess,
} from "@/lib/trial";

interface TrialStatus {
  isLoading: boolean;
  accessLevel: AccessLevel;
  isPro: boolean;
  isTrialActive: boolean;
  hasFullAccess: boolean;
  daysRemaining: number;
  trialEndsAt: string | null;
}

export function useTrial(): TrialStatus {
  // Task #181 cleanup: read auth from the single AuthProvider. The hook
  // itself stays — we still need to fetch users.is_pro / trial_ends_at
  // and re-derive the status struct — we just don't fire our own
  // getUser() round-trip anymore.
  const { user, loading: authLoading } = useAuth();
  const [status, setStatus] = useState<TrialStatus>({
    isLoading: true,
    accessLevel: "free",
    isPro: false,
    isTrialActive: false,
    hasFullAccess: false,
    daysRemaining: 0,
    trialEndsAt: null,
  });

  useEffect(() => {
    // Defer until the central AuthProvider has resolved so we don't briefly
    // mark a logged-in trial user as "free".
    if (authLoading) return;

    const fetchTrialStatus = async () => {
      if (!user) {
        setStatus({
          isLoading: false,
          accessLevel: "free",
          isPro: false,
          isTrialActive: false,
          hasFullAccess: false,
          daysRemaining: 0,
          trialEndsAt: null,
        });
        return;
      }

      // Fetch user's trial/pro status
      const supabase = createClient();
      const { data: profile } = await supabase
        .from("users")
        .select("is_pro, trial_ends_at")
        .eq("id", user.id)
        .single();

      if (profile) {
        const isPro = profile.is_pro || false;
        const trialEndsAt = profile.trial_ends_at;
        const accessLevel = getUserAccessLevel(isPro, trialEndsAt);
        const daysRemaining = getTrialDaysRemaining(trialEndsAt);

        setStatus({
          isLoading: false,
          accessLevel,
          isPro,
          isTrialActive: accessLevel === "trial",
          hasFullAccess: hasFullAccess(isPro, trialEndsAt),
          daysRemaining,
          trialEndsAt,
        });
      } else {
        setStatus({
          isLoading: false,
          accessLevel: "free",
          isPro: false,
          isTrialActive: false,
          hasFullAccess: false,
          daysRemaining: 0,
          trialEndsAt: null,
        });
      }
    };

    fetchTrialStatus();
  }, [authLoading, user]);

  return status;
}
