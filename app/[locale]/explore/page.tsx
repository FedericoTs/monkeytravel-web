import { Metadata } from "next";
import ExploreClient from "./ExploreClient";

export const metadata: Metadata = {
  title: "Explore Trending Trips | MonkeyTravel",
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
