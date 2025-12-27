"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import BookingCTA from "./BookingCTA";
import AffiliateDisclosure from "./AffiliateDisclosure";
import {
  generateFlightLink,
  generateHotelLink,
  generateCarRentalLink,
  generateActivityLink,
  isAffiliateConfigured,
} from "@/lib/affiliates";

interface BookingPanelProps {
  tripId: string;
  destination: string;
  /** Origin airport IATA code (optional - for flights) */
  originAirport?: string;
  /** Destination airport IATA code (optional - for flights) */
  destinationAirport?: string;
  startDate: string;
  endDate: string;
  travelers?: number;
  className?: string;
  /** Show as compact inline buttons or full panel */
  variant?: "panel" | "inline";
}

export default function BookingPanel({
  tripId,
  destination,
  originAirport,
  destinationAirport,
  startDate,
  endDate,
  travelers = 2,
  className = "",
  variant = "panel",
}: BookingPanelProps) {
  const t = useTranslations("common.booking");

  // Generate all booking links
  const links = useMemo(() => {
    if (!isAffiliateConfigured()) {
      return null;
    }

    const flight =
      originAirport && destinationAirport
        ? generateFlightLink({
            origin: originAirport,
            destination: destinationAirport,
            departDate: startDate,
            returnDate: endDate,
            passengers: travelers,
          })
        : null;

    const hotel = generateHotelLink({
      destination,
      checkIn: startDate,
      checkOut: endDate,
      guests: travelers,
    });

    const carRental = generateCarRentalLink({
      pickupLocation: destinationAirport || destination,
      pickupDate: startDate,
      dropoffDate: endDate,
    });

    const activities = generateActivityLink({
      destination,
    });

    return { flight, hotel, carRental, activities };
  }, [
    destination,
    originAirport,
    destinationAirport,
    startDate,
    endDate,
    travelers,
  ]);

  if (!links) {
    return null;
  }

  // Inline variant - just buttons
  if (variant === "inline") {
    return (
      <div className={`flex flex-wrap gap-2 ${className}`}>
        {links.flight && (
          <BookingCTA
            type="flight"
            href={links.flight}
            destination={destination}
            tripId={tripId}
            variant="secondary"
            size="sm"
          />
        )}
        <BookingCTA
          type="hotel"
          href={links.hotel}
          destination={destination}
          tripId={tripId}
          variant="secondary"
          size="sm"
        />
        <BookingCTA
          type="activity"
          href={links.activities}
          destination={destination}
          tripId={tripId}
          variant="secondary"
          size="sm"
        />
      </div>
    );
  }

  // Full panel variant
  return (
    <div
      className={`bg-white border border-slate-200 rounded-xl p-4 ${className}`}
    >
      <h3 className="font-semibold text-slate-900 mb-3">{t("bookYourTrip")}</h3>

      <div className="space-y-2">
        {links.flight && (
          <BookingCTA
            type="flight"
            href={links.flight}
            destination={destination}
            tripId={tripId}
            variant="primary"
            size="md"
            className="w-full"
          />
        )}

        <BookingCTA
          type="hotel"
          href={links.hotel}
          destination={destination}
          tripId={tripId}
          variant="primary"
          size="md"
          className="w-full"
        />

        <BookingCTA
          type="car"
          href={links.carRental}
          destination={destination}
          tripId={tripId}
          variant="outline"
          size="md"
          className="w-full"
        />

        <BookingCTA
          type="activity"
          href={links.activities}
          destination={destination}
          tripId={tripId}
          variant="outline"
          size="md"
          className="w-full"
        />
      </div>

      <AffiliateDisclosure className="mt-3" />
    </div>
  );
}
