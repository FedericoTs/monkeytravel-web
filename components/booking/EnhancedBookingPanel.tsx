"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Plane, Hotel, Car, Ticket, Train, ExternalLink, ChevronDown, ChevronUp } from "lucide-react";
import {
  generateAllHotelLinks,
  generateAllFlightLinks,
  generateAllActivityLinks,
  generateOmioLink,
  getCityIATA,
  getCityRegion,
  getBestHotelPartner,
  getBestFlightPartner,
  getBestActivityPartner,
  isOmioRelevant,
  PARTNERS,
  type PartnerKey,
} from "@/lib/affiliates";
import { capture } from "@/lib/posthog";
import AffiliateDisclosure from "./AffiliateDisclosure";

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

interface PartnerLinkProps {
  partner: PartnerKey;
  href: string;
  isPrimary?: boolean;
  tripId: string;
  destination: string;
  category: string;
}

function PartnerLink({ partner, href, isPrimary, tripId, destination, category }: PartnerLinkProps) {
  const config = PARTNERS[partner];

  const handleClick = () => {
    capture("booking_partner_click", {
      partner,
      partner_name: config.name,
      category,
      destination,
      trip_id: tripId,
      is_primary: isPrimary,
    });
  };

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer sponsored"
      onClick={handleClick}
      className={`
        flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors
        ${isPrimary
          ? "bg-[var(--primary)] text-white hover:bg-[var(--primary)]/90"
          : "bg-slate-100 text-slate-700 hover:bg-slate-200"
        }
      `}
    >
      <span>{config.icon}</span>
      <span className="flex-1">{config.name}</span>
      <ExternalLink className="w-3.5 h-3.5 opacity-60" />
    </a>
  );
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
              {destination} · {formatDateRange(startDate, endDate)} · {travelers} {t("travelers")}
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
            <span className="text-sm font-medium text-slate-700">{t("hotels")}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <PartnerLink
              partner="booking"
              href={links.hotels.booking}
              isPrimary={bestHotel === "booking"}
              tripId={tripId}
              destination={destination}
              category="hotels"
            />
            <PartnerLink
              partner="agoda"
              href={links.hotels.agoda}
              isPrimary={bestHotel === "agoda"}
              tripId={tripId}
              destination={destination}
              category="hotels"
            />
            <PartnerLink
              partner="vrbo"
              href={links.hotels.vrbo}
              tripId={tripId}
              destination={destination}
              category="hotels"
            />
          </div>
        </div>

        {/* Flights Section */}
        {links.flights ? (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Plane className="w-4 h-4 text-slate-600" />
              <span className="text-sm font-medium text-slate-700">{t("flights")}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <PartnerLink
                partner="tripcom"
                href={links.flights.tripcom}
                isPrimary={bestFlight === "tripcom"}
                tripId={tripId}
                destination={destination}
                category="flights"
              />
              <PartnerLink
                partner="cheapoair"
                href={links.flights.cheapoair}
                isPrimary={bestFlight === "cheapoair"}
                tripId={tripId}
                destination={destination}
                category="flights"
              />
              <PartnerLink
                partner="expedia"
                href={links.flights.expedia}
                isPrimary={bestFlight === "expedia"}
                tripId={tripId}
                destination={destination}
                category="flights"
              />
            </div>
          </div>
        ) : (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Plane className="w-4 h-4 text-slate-600" />
              <span className="text-sm font-medium text-slate-700">{t("flights")}</span>
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
            <PartnerLink
              partner="getyourguide"
              href={links.activities.getyourguide}
              isPrimary={bestActivity === "getyourguide"}
              tripId={tripId}
              destination={destination}
              category="activities"
            />
            <PartnerLink
              partner="klook"
              href={links.activities.klook}
              isPrimary={bestActivity === "klook"}
              tripId={tripId}
              destination={destination}
              category="activities"
            />
            <PartnerLink
              partner="tiqets"
              href={links.activities.tiqets}
              isPrimary={bestActivity === "tiqets"}
              tripId={tripId}
              destination={destination}
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
              <PartnerLink
                partner="omio"
                href={links.transport.omio}
                isPrimary
                tripId={tripId}
                destination={destination}
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

// Helper function
function formatDateRange(start: string, end: string): string {
  const startDate = new Date(start);
  const endDate = new Date(end);

  const options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };

  if (startDate.getMonth() === endDate.getMonth()) {
    return `${startDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })} - ${endDate.getDate()}`;
  }

  return `${startDate.toLocaleDateString("en-US", options)} - ${endDate.toLocaleDateString("en-US", options)}`;
}
