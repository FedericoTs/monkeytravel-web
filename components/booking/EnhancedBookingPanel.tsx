"use client";

import { useMemo, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Plane, Hotel, Ticket, Train, ChevronDown, ChevronUp } from "lucide-react";
import {
  generateAllHotelLinks,
  generateAllFlightLinks,
  generateAllActivityLinks,
  generateOmioLink,
  getCityRegion,
  getBestHotelPartner,
  getBestFlightPartner,
  getBestActivityPartner,
} from "@/lib/affiliates";
import { capture } from "@/lib/posthog";
import AffiliateDisclosure from "./AffiliateDisclosure";
import PartnerButton from "./PartnerButton";

interface EnhancedBookingPanelProps {
  tripId: string;
  destination: string;
  /** User's origin city for flights */
  originCity?: string;
  startDate: string;
  endDate: string;
  travelers?: number;
  className?: string;
  /** Show expanded partner options or just best picks */
  variant?: "compact" | "expanded";
  /** Callback when user wants to set their origin city for flights */
  onSetOrigin?: () => void;
}

export default function EnhancedBookingPanel({
  tripId,
  destination,
  originCity,
  startDate,
  endDate,
  travelers = 2,
  className = "",
  variant = "compact",
  onSetOrigin,
}: EnhancedBookingPanelProps) {
  const t = useTranslations("common.booking");
  const locale = useLocale();
  const [isExpanded, setIsExpanded] = useState(variant === "expanded");

  // Generate all links
  const links = useMemo(() => {
    // Hotels
    const hotels = generateAllHotelLinks({
      destination,
      checkIn: startDate,
      checkOut: endDate,
      guests: travelers,
    });

    // Flights (only if we have origin)
    const flights = originCity
      ? generateAllFlightLinks({
          origin: originCity,
          destination,
          departDate: startDate,
          returnDate: endDate,
          passengers: travelers,
        })
      : null;

    // Activities
    const activities = generateAllActivityLinks({ destination });

    // Transport (Omio - only for Europe)
    const region = getCityRegion(destination);
    const transport = region === "europe"
      ? {
          omio: generateOmioLink({
            origin: destination,
            destination: destination, // Generic search
            date: startDate,
            passengers: travelers,
          }),
        }
      : null;

    return { hotels, flights, activities, transport };
  }, [destination, originCity, startDate, endDate, travelers]);

  // Determine best partners
  const bestHotel = getBestHotelPartner(destination);
  const bestFlight = originCity ? getBestFlightPartner(originCity, destination) : null;
  const bestActivity = getBestActivityPartner(destination);

  // Track panel view
  useMemo(() => {
    capture("booking_panel_view", {
      trip_id: tripId,
      destination,
      has_origin: Boolean(originCity),
      variant,
    });
  }, [tripId, destination, originCity, variant]);

  return (
    <div className={`bg-white border border-slate-200 rounded-xl overflow-hidden ${className}`}>
      {/* Header */}
      <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-slate-900">{t("bookYourTrip")}</h3>
            <p className="text-sm text-slate-600">
              {destination} · {formatDateRange(startDate, endDate, locale)} · {t("travelersCount", { count: travelers })}
            </p>
          </div>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-2 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg"
          >
            {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
          </button>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Hotels Section */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Hotel className="w-4 h-4 text-slate-600" />
            <span className="text-sm font-medium text-slate-700">{t("hotelsLabel")}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <PartnerButton
              partner="booking"
              href={links.hotels.booking}
              isPrimary={bestHotel === "booking"}
              variant={bestHotel === "booking" ? "primary" : "secondary"}
              size="sm"
              tripId={tripId}
              destination={destination}
              surface="trip_detail_panel"
              category="hotels"
            />
            <PartnerButton
              partner="agoda"
              href={links.hotels.agoda}
              isPrimary={bestHotel === "agoda"}
              variant={bestHotel === "agoda" ? "primary" : "secondary"}
              size="sm"
              tripId={tripId}
              destination={destination}
              surface="trip_detail_panel"
              category="hotels"
            />
            <PartnerButton
              partner="vrbo"
              href={links.hotels.vrbo}
              variant="secondary"
              size="sm"
              tripId={tripId}
              destination={destination}
              surface="trip_detail_panel"
              category="hotels"
            />
          </div>
        </div>

        {/* Flights Section */}
        {links.flights ? (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Plane className="w-4 h-4 text-slate-600" />
              <span className="text-sm font-medium text-slate-700">{t("flightsLabel")}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <PartnerButton
                partner="tripcom"
                href={links.flights.tripcom}
                isPrimary={bestFlight === "tripcom"}
                variant={bestFlight === "tripcom" ? "primary" : "secondary"}
                size="sm"
                tripId={tripId}
                destination={destination}
                surface="trip_detail_panel"
                category="flights"
              />
              <PartnerButton
                partner="cheapoair"
                href={links.flights.cheapoair}
                isPrimary={bestFlight === "cheapoair"}
                variant={bestFlight === "cheapoair" ? "primary" : "secondary"}
                size="sm"
                tripId={tripId}
                destination={destination}
                surface="trip_detail_panel"
                category="flights"
              />
              <PartnerButton
                partner="expedia"
                href={links.flights.expedia}
                isPrimary={bestFlight === "expedia"}
                variant={bestFlight === "expedia" ? "primary" : "secondary"}
                size="sm"
                tripId={tripId}
                destination={destination}
                surface="trip_detail_panel"
                category="flights"
              />
            </div>
          </div>
        ) : (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Plane className="w-4 h-4 text-slate-600" />
              <span className="text-sm font-medium text-slate-700">{t("flightsLabel")}</span>
            </div>
            <div className="bg-slate-50 rounded-lg p-3 text-center">
              <p className="text-sm text-slate-600">{t("flightsNeedOrigin")}</p>
              <button
                onClick={() => {
                  capture("booking_drawer_request", { trip_id: tripId, type: "flights" });
                  onSetOrigin?.();
                }}
                className="mt-2 px-4 py-2 bg-[var(--primary)] text-white text-sm font-medium rounded-lg hover:bg-[var(--primary)]/90"
              >
                {t("setOriginCity")}
              </button>
            </div>
          </div>
        )}

        {/* Activities Section */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Ticket className="w-4 h-4 text-slate-600" />
            <span className="text-sm font-medium text-slate-700">{t("activitiesAttractions")}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <PartnerButton
              partner="getyourguide"
              href={links.activities.getyourguide}
              isPrimary={bestActivity === "getyourguide"}
              variant={bestActivity === "getyourguide" ? "primary" : "secondary"}
              size="sm"
              tripId={tripId}
              destination={destination}
              surface="trip_detail_panel"
              category="activities"
            />
            <PartnerButton
              partner="klook"
              href={links.activities.klook}
              isPrimary={bestActivity === "klook"}
              variant={bestActivity === "klook" ? "primary" : "secondary"}
              size="sm"
              tripId={tripId}
              destination={destination}
              surface="trip_detail_panel"
              category="activities"
            />
            <PartnerButton
              partner="tiqets"
              href={links.activities.tiqets}
              isPrimary={bestActivity === "tiqets"}
              variant={bestActivity === "tiqets" ? "primary" : "secondary"}
              size="sm"
              tripId={tripId}
              destination={destination}
              surface="trip_detail_panel"
              category="activities"
            />
          </div>
        </div>

        {/* Transport Section (Europe only) */}
        {links.transport && isExpanded && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Train className="w-4 h-4 text-slate-600" />
              <span className="text-sm font-medium text-slate-700">{t("trainsBuses")}</span>
            </div>
            <div className="grid grid-cols-1 gap-2">
              <PartnerButton
                partner="omio"
                href={links.transport.omio}
                isPrimary
                variant="primary"
                size="sm"
                tripId={tripId}
                destination={destination}
                surface="trip_detail_panel"
                category="transport"
              />
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 bg-slate-50 border-t border-slate-200">
        <AffiliateDisclosure />
      </div>
    </div>
  );
}

// Helper function.
//
// Accepts the active locale so the month abbreviation matches the user's
// language ("mag" on /it, "may" on /es, "May" on /en). Previously hardcoded
// "en-US" and showed English month abbreviations on every locale — caught
// in live UI test 2026-05-30, task #241.
function formatDateRange(start: string, end: string, locale: string): string {
  const startDate = new Date(start);
  const endDate = new Date(end);

  const options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };

  if (startDate.getMonth() === endDate.getMonth()) {
    return `${startDate.toLocaleDateString(locale, options)} - ${endDate.getDate()}`;
  }

  return `${startDate.toLocaleDateString(locale, options)} - ${endDate.toLocaleDateString(locale, options)}`;
}
