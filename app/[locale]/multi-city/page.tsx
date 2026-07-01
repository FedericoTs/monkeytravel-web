import { redirect } from "next/navigation";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Multi-City Trips",
  description: "Plan a multi-city trip with MonkeyTravel's AI trip planner.",
};

// The standalone /multi-city page was a save-less "Preview" surface built to
// exercise the per-city generator before the wizard integration landed. That
// integration has shipped: /trips/new now has a "Plan multiple cities" toggle
// → route builder → per-city generation WITH save. This preview had no save
// flow and zero inbound links, so we redirect any bookmarks/old links to the
// real multi-city entry point instead of stranding users on a dead surface.
//
// The reusable pieces (JourneyRibbon, MultiCityRouteBuilder) live on and are
// used by the wizard — only this orphaned page is retired.
export default function MultiCityPage(): never {
  redirect("/trips/new");
}
