/**
 * Post-trip follow-ups are marketing. They go only to people who came back
 * after making the trip: opened one of our emails, used the app or signed in
 * at least a day later, which leaves out the visit that saved the trip.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export const CAME_BACK_AFTER_MS = 24 * 60 * 60 * 1000;

/** When activity starts to count as coming back; null for an unreadable date. */
export function cameBackFrom(tripCreatedAt: string | null | undefined): string | null {
  const t = tripCreatedAt ? Date.parse(tripCreatedAt) : NaN;
  return Number.isNaN(t) ? null : new Date(t + CAME_BACK_AFTER_MS).toISOString();
}

export interface EngagementSignals {
  /** An email to them was opened on or after `from`. */
  openedEmail: boolean;
  /** They viewed a page signed in on or after `from`. */
  usedApp: boolean;
  /** Their last sign-in, from auth; null when there is none. */
  lastSignInAt: string | null;
}

export function cameBack(from: string, signals: EngagementSignals): boolean {
  if (signals.openedEmail || signals.usedApp) return true;
  const signIn = signals.lastSignInAt ? Date.parse(signals.lastSignInAt) : NaN;
  return !Number.isNaN(signIn) && signIn >= Date.parse(from);
}

/**
 * Reads the signals for one recipient. Throws on a read error, so the caller
 * can fail closed: unknown is not "came back".
 */
export async function loadEngagement(
  svc: SupabaseClient,
  userId: string,
  email: string,
  from: string
): Promise<EngagementSignals> {
  const [opened, visited, auth] = await Promise.all([
    svc.from("email_log").select("id").eq("recipient_email", email).gte("opened_at", from).limit(1),
    svc.from("page_views").select("id").eq("user_id", userId).gte("created_at", from).limit(1),
    svc.auth.admin.getUserById(userId),
  ]);
  if (opened.error) throw opened.error;
  if (visited.error) throw visited.error;
  // An account that no longer exists in auth has simply not signed in.
  if (auth.error && auth.error.status !== 404) throw auth.error;
  return {
    openedEmail: (opened.data?.length ?? 0) > 0,
    usedApp: (visited.data?.length ?? 0) > 0,
    lastSignInAt: auth.data?.user?.last_sign_in_at ?? null,
  };
}
