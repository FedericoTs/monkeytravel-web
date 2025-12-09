"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
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
    const fetchTrialStatus = async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

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
  }, []);

  return status;
}
