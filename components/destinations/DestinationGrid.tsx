import type { Destination, Locale } from "@/lib/destinations/types";
import DestinationCard from "./DestinationCard";

interface DestinationGridProps {
  destinations: Destination[];
  locale: Locale;
  planTripLabel: string;
}

export default function DestinationGrid({
  destinations,
  locale,
  planTripLabel,
}: DestinationGridProps) {
  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
      {destinations.map((destination) => (
        <DestinationCard
          key={destination.slug}
          destination={destination}
          locale={locale}
          planTripLabel={planTripLabel}
        />
      ))}
    </div>
  );
}
