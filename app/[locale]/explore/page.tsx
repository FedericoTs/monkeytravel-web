import { Metadata } from "next";
import ExploreClient from "./ExploreClient";

export const metadata: Metadata = {
  // Root layout's title.template appends " | MonkeyTravel" — don't add
  // the suffix here in metadata.title or the rendered <title> doubles.
  // openGraph.title intentionally keeps the brand since OG previews are
  // shown out of context (social cards) and need the brand suffix.
  title: "Explore Trending Trips",
  description: "Discover inspiring travel itineraries shared by the MonkeyTravel community. Browse trending destinations, copy trips, and start planning your next adventure.",
  openGraph: {
    title: "Explore Trending Trips | MonkeyTravel",
    description: "Discover inspiring travel itineraries shared by the MonkeyTravel community.",
    type: "website",
  },
};

export default function ExplorePage() {
  return <ExploreClient />;
}
