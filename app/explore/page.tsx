import type { Metadata } from "next";
import ExploreClient from "./ExploreClient";

export const metadata: Metadata = {
  title: "Explore Trips | MonkeyTravel",
  description: "Discover amazing AI-generated travel itineraries from travelers around the world. Get inspired for your next adventure.",
  openGraph: {
    title: "Explore Trips | MonkeyTravel",
    description: "Discover amazing AI-generated travel itineraries from travelers around the world.",
    type: "website",
  },
};

export default function ExplorePage() {
  return <ExploreClient />;
}
