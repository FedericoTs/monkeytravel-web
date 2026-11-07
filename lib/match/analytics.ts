import { onPostHogReady } from "@/lib/posthog/client";

export type MatchShareMethod = "native_image" | "native_link" | "whatsapp" | "copy" | "download";

/** Only reaches visitors who accepted analytics. */
function capture(event: string, properties: Record<string, string | number | boolean>): void {
  onPostHogReady((posthog) => posthog.capture(event, properties));
}

/** The site's own count, the same for everyone. It must never get in the way of what was pressed. */
function count(body: Record<string, string>): void {
  try {
    void fetch("/api/funnel-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
    });
  } catch {
    // Nothing to do: the visitor is already on their way.
  }
}

export const trackMatchStarted = (withFriend: boolean) => capture("match_started", { with_friend: withFriend });

export const trackMatchFinished = (place: string, type: string, together: boolean) => capture("match_finished", { place, type, together });

export const trackFindMine = (place: string) => capture("match_find_mine_clicked", { place });

export function trackMatchPlan(place: string, from: "own" | "friend"): void {
  capture("match_plan_clicked", { place, from });
  count({ event_type: "plan_own_clicked", destination: place, surface: "match" });
}

export function trackMatchShare(method: MatchShareMethod, place: string): void {
  capture("match_shared", { method, place });
  count({ event_type: "trip_card_shared", kind: "match", method });
}
