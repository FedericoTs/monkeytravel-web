"use client";

import { useState } from "react";
import type { BookingLink } from "@/types";

interface TripBookingLinksProps {
  bookingLinks?: {
    flights: BookingLink[];
    hotels: BookingLink[];
  };
  className?: string;
}

// Provider logos/icons with brand colors
const providerConfig: Record<string, { color: string; bgColor: string }> = {
  "Google Flights": { color: "text-blue-600", bgColor: "bg-blue-50 hover:bg-blue-100" },
  "Skyscanner": { color: "text-cyan-600", bgColor: "bg-cyan-50 hover:bg-cyan-100" },
  "Kayak": { color: "text-orange-600", bgColor: "bg-orange-50 hover:bg-orange-100" },
  "Expedia": { color: "text-yellow-600", bgColor: "bg-yellow-50 hover:bg-yellow-100" },
  "Booking.com": { color: "text-blue-700", bgColor: "bg-blue-50 hover:bg-blue-100" },
  "Hotels.com": { color: "text-red-600", bgColor: "bg-red-50 hover:bg-red-100" },
  "Airbnb": { color: "text-rose-500", bgColor: "bg-rose-50 hover:bg-rose-100" },
  "Tripadvisor": { color: "text-emerald-600", bgColor: "bg-emerald-50 hover:bg-emerald-100" },
  "Agoda": { color: "text-purple-600", bgColor: "bg-purple-50 hover:bg-purple-100" },
  "Hostelworld": { color: "text-orange-500", bgColor: "bg-orange-50 hover:bg-orange-100" },
};

function getProviderStyle(provider: string) {
  // Try exact match first
  if (providerConfig[provider]) {
    return providerConfig[provider];
  }
  // Try partial match
  for (const [key, value] of Object.entries(providerConfig)) {
    if (provider.toLowerCase().includes(key.toLowerCase())) {
      return value;
    }
  }
  // Default
  return { color: "text-slate-600", bgColor: "bg-slate-50 hover:bg-slate-100" };
}

export default function TripBookingLinks({ bookingLinks, className = "" }: TripBookingLinksProps) {
  const [activeTab, setActiveTab] = useState<"flights" | "hotels">("flights");

  if (!bookingLinks) {
    return null;
  }

  const hasFlights = bookingLinks.flights && bookingLinks.flights.length > 0;
  const hasHotels = bookingLinks.hotels && bookingLinks.hotels.length > 0;

  if (!hasFlights && !hasHotels) {
    return null;
  }

  const activeLinks = activeTab === "flights" ? bookingLinks.flights : bookingLinks.hotels;

  return (
    <div className={`mb-8 ${className}`}>
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center">
          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Book Your Trip</h2>
          <p className="text-xs text-slate-500">Compare prices across platforms</p>
        </div>
      </div>

      {/* Card Container */}
      <div className="bg-gradient-to-br from-amber-50/80 via-white to-orange-50/80 rounded-2xl border border-amber-100 overflow-hidden">
        {/* Tab Switcher */}
        <div className="flex border-b border-amber-100">
          <button
            onClick={() => setActiveTab("flights")}
            disabled={!hasFlights}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-all flex items-center justify-center gap-2 ${
              activeTab === "flights"
                ? "bg-white text-amber-700 border-b-2 border-amber-500 -mb-px"
                : hasFlights
                ? "text-slate-600 hover:text-slate-900 hover:bg-white/50"
                : "text-slate-400 cursor-not-allowed"
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
            Flights
            {hasFlights && (
              <span className="px-1.5 py-0.5 text-xs bg-amber-100 text-amber-700 rounded-full">
                {bookingLinks.flights.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab("hotels")}
            disabled={!hasHotels}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-all flex items-center justify-center gap-2 ${
              activeTab === "hotels"
                ? "bg-white text-amber-700 border-b-2 border-amber-500 -mb-px"
                : hasHotels
                ? "text-slate-600 hover:text-slate-900 hover:bg-white/50"
                : "text-slate-400 cursor-not-allowed"
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
            Hotels
            {hasHotels && (
              <span className="px-1.5 py-0.5 text-xs bg-amber-100 text-amber-700 rounded-full">
                {bookingLinks.hotels.length}
              </span>
            )}
          </button>
        </div>

        {/* Links Grid */}
        <div className="p-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {activeLinks?.map((link, idx) => {
              const style = getProviderStyle(link.provider);
              return (
                <a
                  key={idx}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`group relative flex flex-col items-center justify-center gap-2 p-4 rounded-xl border border-transparent ${style.bgColor} transition-all duration-200 hover:shadow-md hover:scale-[1.02] hover:border-amber-200`}
                >
                  {/* Provider Icon */}
                  <div className={`w-10 h-10 rounded-full bg-white shadow-sm flex items-center justify-center ${style.color}`}>
                    {activeTab === "flights" ? (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                      </svg>
                    ) : (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                      </svg>
                    )}
                  </div>

                  {/* Provider Name */}
                  <span className={`text-sm font-medium ${style.color} text-center`}>
                    {link.provider}
                  </span>

                  {/* External link indicator */}
                  <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </div>
                </a>
              );
            })}
          </div>

          {/* Disclaimer */}
          <p className="mt-4 text-xs text-center text-slate-500">
            Prices and availability may vary. Click to compare on each platform.
          </p>
        </div>
      </div>
    </div>
  );
}
