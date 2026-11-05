/** Which "plan your own trip" link on a shared or public trip was pressed. */
export type PlanOwnSurface = "shared_footer" | "public_footer" | "public_top" | "after_vote" | "page_footer" | "bottom_bar";

/**
 * The public page asks for "a trip like this one", so its links also carry the
 * trip's length (?days=, which the wizard takes for a single city, up to 14 days)
 * and say where they came from (?from=trip). Null elsewhere.
 */
export function likeThisDays(shareToken: string | undefined, destination: string, dayCount: number): number | null {
  return !shareToken && !destination.includes(" & ") && dayCount >= 1 && dayCount <= 14 ? dayCount : null;
}

/**
 * The creation wizard, carrying the owner's referral code (?ref) so the new user is
 * attributed to them at signup, and the destination (?destination=), which the
 * wizard pre-fills. Both are optional: without ref the link still works, it just
 * won't attribute.
 */
export function planOwnHref({
  destination,
  days,
  referralCode,
}: {
  destination: string;
  days: number | null;
  referralCode: string | null;
}): string {
  const params = new URLSearchParams();
  if (destination) params.set("destination", destination);
  if (days) {
    params.set("days", String(days));
    params.set("from", "trip");
  }
  if (referralCode) params.set("ref", referralCode);
  const qs = params.toString();
  return qs ? `/trips/new?${qs}` : "/trips/new";
}

/**
 * The crew loop's last measured hop: a visitor converting to plan their OWN trip.
 * Fire-and-forget with keepalive so the event survives the same-origin navigation
 * the link triggers. Never blocks navigation.
 */
export function reportPlanOwnClicked({
  tripId,
  destination,
  referralCode,
  surface,
}: {
  tripId: string;
  destination: string;
  referralCode: string | null;
  surface: PlanOwnSurface;
}): void {
  try {
    void fetch("/api/funnel-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event_type: "plan_own_clicked",
        trip_id: tripId,
        destination: destination || undefined,
        referral_code: referralCode || undefined,
        surface,
      }),
      keepalive: true,
    });
  } catch {
    // telemetry must never block the visitor's navigation
  }
}
