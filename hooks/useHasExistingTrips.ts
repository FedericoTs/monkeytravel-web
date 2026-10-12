import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Whether the signed-in user already has trips (step 1's welcome-back banner).
 * The server page counted them for the user it rendered for, so the browser
 * counts only for someone else, e.g. after signing in on the page.
 */
export function useHasExistingTrips(
  authLoading: boolean,
  userId: string | null,
  server: { userId: string | null; hasTrips: boolean }
): boolean {
  const [counted, setCounted] = useState<{ userId: string; hasTrips: boolean } | null>(null);
  const toCount = !authLoading && userId && userId !== server.userId ? userId : null;

  useEffect(() => {
    if (!toCount) return;
    void createClient()
      .from("trips")
      .select("id", { count: "exact", head: true })
      .eq("user_id", toCount)
      .then(({ count }) => setCounted({ userId: toCount, hasTrips: (count ?? 0) > 0 }));
  }, [toCount]);

  if (authLoading) return server.hasTrips;
  if (!userId) return false;
  if (userId === server.userId) return server.hasTrips;
  return counted?.userId === userId && counted.hasTrips;
}
