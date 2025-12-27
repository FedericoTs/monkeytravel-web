"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { X, Plane, MapPin, Clock } from "lucide-react";
import { getCityIATA, CITY_IATA_CODES } from "@/lib/affiliates";
import { capture } from "@/lib/posthog";
import {
  generateTripComLink,
  generateCheapOairLink,
  generateExpediaFlightLink,
  getBestFlightPartner,
} from "@/lib/affiliates";

interface BookingDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  destination: string;
  startDate: string;
  endDate: string;
  travelers: number;
  tripId: string;
}

const RECENT_ORIGINS_KEY = "monkeytravel_recent_origins";

export default function BookingDrawer({
  isOpen,
  onClose,
  destination,
  startDate,
  endDate,
  travelers,
  tripId,
}: BookingDrawerProps) {
  const t = useTranslations("common.booking");
  const [originCity, setOriginCity] = useState("");
  const [recentOrigins, setRecentOrigins] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);

  // Load recent origins from localStorage
  useEffect(() => {
    if (typeof window !== "undefined") {
      const recent = localStorage.getItem(RECENT_ORIGINS_KEY);
      if (recent) {
        try {
          setRecentOrigins(JSON.parse(recent));
        } catch {
          // Ignore parse errors
        }
      }
    }
  }, []);

  // Track drawer open
  useEffect(() => {
    if (isOpen) {
      capture("booking_drawer_opened", {
        type: "flights",
        destination,
        trip_id: tripId,
      });
    }
  }, [isOpen, destination, tripId]);

  // Filter city suggestions
  useEffect(() => {
    if (originCity.length < 2) {
      setSuggestions([]);
      return;
    }

    const query = originCity.toLowerCase();
    const matches = Object.keys(CITY_IATA_CODES).filter((city) =>
      city.toLowerCase().includes(query)
    ).slice(0, 5);

    setSuggestions(matches);
  }, [originCity]);

  const handleSearch = useCallback(() => {
    if (!originCity) return;

    // Save to recent origins
    const updated = [
      originCity,
      ...recentOrigins.filter((o) => o !== originCity),
    ].slice(0, 5);
    localStorage.setItem(RECENT_ORIGINS_KEY, JSON.stringify(updated));

    // Track origin selection
    capture("booking_origin_selected", {
      origin_city: originCity,
      origin_code: getCityIATA(originCity),
      destination,
      trip_id: tripId,
    });

    // Determine best flight partner and open link
    const bestPartner = getBestFlightPartner(originCity, destination);

    let flightUrl: string;
    const params = {
      origin: originCity,
      destination,
      departDate: startDate,
      returnDate: endDate,
      passengers: travelers,
    };

    if (bestPartner === "tripcom") {
      flightUrl = generateTripComLink(params);
    } else if (bestPartner === "cheapoair") {
      flightUrl = generateCheapOairLink(params);
    } else {
      flightUrl = generateExpediaFlightLink(params);
    }

    // Track and open
    capture("booking_external_redirect", {
      partner: bestPartner,
      type: "flights",
      destination,
      trip_id: tripId,
    });

    window.open(flightUrl, "_blank", "noopener,noreferrer");
    onClose();
  }, [originCity, recentOrigins, destination, startDate, endDate, travelers, tripId, onClose]);

  const handleSelectCity = (city: string) => {
    setOriginCity(city);
    setSuggestions([]);
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40 animate-in fade-in duration-200"
        onClick={onClose}
      />

      {/* Drawer - positioned above bottom nav on mobile */}
      <div className="fixed left-0 right-0 bg-white rounded-t-2xl z-[60] shadow-xl animate-in slide-in-from-bottom duration-300 bottom-20 sm:bottom-0">
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-12 h-1.5 bg-slate-200 rounded-full" />
        </div>

        {/* Content */}
        <div className="px-4 pb-6 pb-safe max-h-[60vh] overflow-y-auto">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                <Plane className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-900">
                  {t("whereFlying")}
                </h3>
                <p className="text-sm text-slate-500">
                  {destination} · {formatDateRange(startDate, endDate)}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Input */}
          <div className="relative mb-4">
            <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input
              type="text"
              value={originCity}
              onChange={(e) => setOriginCity(e.target.value)}
              placeholder={t("enterCityOrAirport")}
              className="w-full pl-10 pr-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent outline-none"
              autoFocus
            />

            {/* Suggestions dropdown */}
            {suggestions.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden z-10">
                {suggestions.map((city) => (
                  <button
                    key={city}
                    onClick={() => handleSelectCity(city)}
                    className="w-full px-4 py-3 text-left hover:bg-slate-50 flex items-center gap-2"
                  >
                    <MapPin className="w-4 h-4 text-slate-400" />
                    <span>{city}</span>
                    <span className="text-sm text-slate-400 ml-auto">
                      {CITY_IATA_CODES[city]}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Recent origins */}
          {recentOrigins.length > 0 && (
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-2">
                <Clock className="w-4 h-4 text-slate-400" />
                <span className="text-sm text-slate-500">{t("recent")}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {recentOrigins.map((city) => (
                  <button
                    key={city}
                    onClick={() => handleSelectCity(city)}
                    className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-full text-sm font-medium text-slate-700"
                  >
                    {city}
                    {getCityIATA(city) && (
                      <span className="text-slate-400 ml-1">
                        ({getCityIATA(city)})
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Search button */}
          <button
            onClick={handleSearch}
            disabled={!originCity}
            className="w-full py-4 bg-[var(--primary)] text-white rounded-xl font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[var(--primary)]/90 transition-colors flex items-center justify-center gap-2"
          >
            <Plane className="w-5 h-5" />
            {t("searchFlightsTo", { destination })}
          </button>

          {/* Note */}
          <p className="text-center text-xs text-slate-400 mt-4">
            {t("externalSiteNote")}
          </p>
        </div>
      </div>
    </>
  );
}

// Helper function
function formatDateRange(start: string, end: string): string {
  const startDate = new Date(start);
  const endDate = new Date(end);

  const options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };

  return `${startDate.toLocaleDateString("en-US", options)} - ${endDate.toLocaleDateString("en-US", options)}`;
}
