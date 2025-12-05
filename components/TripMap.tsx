"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import {
  GoogleMap,
  useJsApiLoader,
  Marker,
  InfoWindow,
} from "@react-google-maps/api";
import type { Activity, ItineraryDay } from "@/types";

// IMPORTANT: Define libraries outside component to prevent infinite re-renders
const GOOGLE_MAPS_LIBRARIES: ("places")[] = ["places"];

interface MapActivity extends Activity {
  dayNumber: number;
  resolvedLocation?: {
    lat: number;
    lng: number;
  };
}

interface TripMapProps {
  days: ItineraryDay[];
  destination: string;
  className?: string;
  selectedDay?: number | null;
  onActivityClick?: (activity: Activity, dayNumber: number) => void;
}

const mapContainerStyle = {
  width: "100%",
  height: "100%",
};

const defaultCenter = {
  lat: 40.7128,
  lng: -74.006,
};

const mapOptions: google.maps.MapOptions = {
  disableDefaultUI: false,
  zoomControl: true,
  streetViewControl: false,
  mapTypeControl: false,
  fullscreenControl: true,
  styles: [
    {
      featureType: "poi",
      elementType: "labels",
      stylers: [{ visibility: "off" }],
    },
    {
      featureType: "transit",
      elementType: "labels",
      stylers: [{ visibility: "off" }],
    },
  ],
};

// Day colors for markers - Fresh Voyager theme
const DAY_COLORS = [
  "#FF6B6B", // Day 1 - Coral (primary)
  "#00B4A6", // Day 2 - Teal (secondary)
  "#FFD93D", // Day 3 - Gold (accent)
  "#A29BFE", // Day 4 - Purple
  "#00B894", // Day 5 - Green
  "#FD79A8", // Day 6 - Pink
  "#74B9FF", // Day 7 - Blue
  "#FDCB6E", // Day 8 - Yellow
];

/**
 * Generate a stable hash for days to detect real changes
 */
function getDaysHash(days: ItineraryDay[]): string {
  return days
    .map((day) =>
      day.activities
        .map((a) => `${a.id || a.name}:${a.address || a.location}:${a.coordinates?.lat || ""}`)
        .join("|")
    )
    .join("||");
}

export default function TripMap({
  days,
  destination,
  className = "",
  selectedDay,
  onActivityClick,
}: TripMapProps) {
  const [map, setMap] = useState<google.maps.Map | null>(null);
  const [selectedActivity, setSelectedActivity] = useState<MapActivity | null>(
    null
  );
  const [activities, setActivities] = useState<MapActivity[]>([]);
  const [mapCenter, setMapCenter] = useState(defaultCenter);
  const [isGeocoding, setIsGeocoding] = useState(false);

  // Prevent duplicate fetches
  const fetchedHashRef = useRef<string>("");
  const isFetchingRef = useRef(false);

  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "",
    libraries: GOOGLE_MAPS_LIBRARIES,
  });

  // Stable hash to detect real changes
  const daysHash = useMemo(() => getDaysHash(days), [days]);

  // Use SERVER-SIDE CACHED geocoding instead of client-side Google Maps Geocoder
  // This saves ~$0.005 per request by using Supabase cache
  useEffect(() => {
    if (!isLoaded) return;

    const geocodeActivities = async () => {
      // Prevent duplicate fetches
      if (isFetchingRef.current) return;
      if (fetchedHashRef.current === daysHash) return;

      isFetchingRef.current = true;
      setIsGeocoding(true);

      const mappedActivities: MapActivity[] = [];
      const addressesToGeocode: string[] = [];
      const addressToActivityMap: Map<string, { day: ItineraryDay; activity: Activity }[]> = new Map();

      // Step 1: Collect activities, prioritize existing coordinates
      for (const day of days) {
        for (const activity of day.activities) {
          // If activity already has coordinates, use them directly (no API call needed!)
          if (activity.coordinates?.lat && activity.coordinates?.lng) {
            mappedActivities.push({
              ...activity,
              dayNumber: day.day_number,
              resolvedLocation: {
                lat: activity.coordinates.lat,
                lng: activity.coordinates.lng,
              },
            });
            continue;
          }

          // Build address for geocoding
          const address = activity.address || activity.location;
          if (address) {
            const fullAddress = `${address}, ${destination}`;

            // Group activities by address to avoid duplicate geocoding
            if (!addressToActivityMap.has(fullAddress)) {
              addressToActivityMap.set(fullAddress, []);
              addressesToGeocode.push(fullAddress);
            }
            addressToActivityMap.get(fullAddress)!.push({ day, activity });
          } else {
            // No coordinates and no address - add without location
            mappedActivities.push({
              ...activity,
              dayNumber: day.day_number,
            });
          }
        }
      }

      // Step 2: Batch geocode via server-side cached API (NOT client-side!)
      if (addressesToGeocode.length > 0) {
        try {
          const response = await fetch("/api/travel/geocode", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ addresses: addressesToGeocode }),
          });

          if (response.ok) {
            const data = await response.json();
            const geocodedMap = new Map<string, { lat: number; lng: number }>();

            for (const result of data.results || []) {
              geocodedMap.set(result.address, { lat: result.lat, lng: result.lng });
            }

            // Map geocoded results back to activities
            for (const [address, activityList] of addressToActivityMap) {
              const coords = geocodedMap.get(address);
              for (const { day, activity } of activityList) {
                mappedActivities.push({
                  ...activity,
                  dayNumber: day.day_number,
                  resolvedLocation: coords,
                });
              }
            }
          } else {
            // API failed - add activities without locations
            for (const [, activityList] of addressToActivityMap) {
              for (const { day, activity } of activityList) {
                mappedActivities.push({
                  ...activity,
                  dayNumber: day.day_number,
                });
              }
            }
          }
        } catch (error) {
          console.error("[TripMap] Geocoding error:", error);
          // On error, add activities without locations
          for (const [, activityList] of addressToActivityMap) {
            for (const { day, activity } of activityList) {
              mappedActivities.push({
                ...activity,
                dayNumber: day.day_number,
              });
            }
          }
        }
      }

      setActivities(mappedActivities);
      setIsGeocoding(false);
      fetchedHashRef.current = daysHash;
      isFetchingRef.current = false;

      // Center map on first activity with location
      const firstWithLocation = mappedActivities.find((a) => a.resolvedLocation);
      if (firstWithLocation?.resolvedLocation) {
        setMapCenter(firstWithLocation.resolvedLocation);
      }
    };

    geocodeActivities();
  }, [isLoaded, daysHash, destination, days]);

  // Fit bounds when activities change
  useEffect(() => {
    if (!map || activities.length === 0) return;

    const bounds = new google.maps.LatLngBounds();
    let hasValidLocations = false;

    activities.forEach((activity) => {
      if (activity.resolvedLocation) {
        bounds.extend(activity.resolvedLocation);
        hasValidLocations = true;
      }
    });

    if (hasValidLocations) {
      map.fitBounds(bounds, {
        top: 50,
        right: 50,
        bottom: 50,
        left: 50,
      });
    }
  }, [map, activities]);

  const onLoad = useCallback((map: google.maps.Map) => {
    setMap(map);
  }, []);

  const onUnmount = useCallback(() => {
    setMap(null);
  }, []);

  const filteredActivities = selectedDay
    ? activities.filter((a) => a.dayNumber === selectedDay)
    : activities;

  if (loadError) {
    return (
      <div className={`bg-slate-100 rounded-xl flex items-center justify-center ${className}`}>
        <p className="text-slate-500">Failed to load map</p>
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div className={`bg-slate-100 rounded-xl flex items-center justify-center animate-pulse ${className}`}>
        <div className="text-slate-400">Loading map...</div>
      </div>
    );
  }

  return (
    <div className={`relative rounded-xl overflow-hidden shadow-lg ${className}`}>
      {isGeocoding && (
        <div className="absolute top-4 left-4 z-10 bg-white/90 backdrop-blur-sm px-3 py-1.5 rounded-full text-sm text-slate-600 shadow-md">
          <span className="inline-block w-2 h-2 bg-[var(--primary)] rounded-full animate-pulse mr-2" />
          Loading locations...
        </div>
      )}

      {/* Day Legend - compact on mobile, detailed on desktop */}
      <div className="absolute bottom-3 left-3 right-3 sm:bottom-auto sm:top-4 sm:left-auto sm:right-4 z-10 bg-white/95 backdrop-blur-sm rounded-lg px-2 py-1.5 sm:p-2 shadow-md max-w-[calc(100%-1.5rem)] sm:max-w-none">
        <div className="text-xs font-medium text-slate-700 mb-1.5 hidden sm:block">Days</div>
        <div className="flex flex-wrap gap-1 justify-center sm:justify-start">
          {days.map((day) => (
            <button
              key={day.day_number}
              onClick={() => {
                const dayActivities = activities.filter(
                  (a) => a.dayNumber === day.day_number && a.resolvedLocation
                );
                if (dayActivities.length > 0 && map) {
                  const bounds = new google.maps.LatLngBounds();
                  dayActivities.forEach((a) => {
                    if (a.resolvedLocation) bounds.extend(a.resolvedLocation);
                  });
                  map.fitBounds(bounds, { top: 50, right: 50, bottom: 50, left: 50 });
                }
              }}
              className={`w-6 h-6 sm:w-6 sm:h-6 rounded-full text-white text-[10px] sm:text-xs font-bold flex items-center justify-center transition-transform hover:scale-110 active:scale-95 ${
                selectedDay === day.day_number ? "ring-2 ring-offset-1 ring-slate-900" : ""
              }`}
              style={{
                backgroundColor: DAY_COLORS[(day.day_number - 1) % DAY_COLORS.length],
              }}
            >
              {day.day_number}
            </button>
          ))}
        </div>
      </div>

      <GoogleMap
        mapContainerStyle={mapContainerStyle}
        center={mapCenter}
        zoom={13}
        onLoad={onLoad}
        onUnmount={onUnmount}
        options={mapOptions}
      >
        {filteredActivities.map((activity, idx) =>
          activity.resolvedLocation ? (
            <Marker
              key={`${activity.dayNumber}-${idx}`}
              position={activity.resolvedLocation}
              onClick={() => setSelectedActivity(activity)}
              icon={{
                path: google.maps.SymbolPath.CIRCLE,
                scale: 12,
                fillColor: DAY_COLORS[(activity.dayNumber - 1) % DAY_COLORS.length],
                fillOpacity: 1,
                strokeColor: "#ffffff",
                strokeWeight: 2,
              }}
              label={{
                text: String(activity.dayNumber),
                color: "#ffffff",
                fontSize: "10px",
                fontWeight: "bold",
              }}
            />
          ) : null
        )}

        {selectedActivity && selectedActivity.resolvedLocation && (
          <InfoWindow
            position={selectedActivity.resolvedLocation}
            onCloseClick={() => setSelectedActivity(null)}
          >
            <div className="p-2 max-w-xs">
              <div className="flex items-center gap-2 mb-1">
                <span
                  className="w-5 h-5 rounded-full text-white text-xs font-bold flex items-center justify-center"
                  style={{
                    backgroundColor:
                      DAY_COLORS[(selectedActivity.dayNumber - 1) % DAY_COLORS.length],
                  }}
                >
                  {selectedActivity.dayNumber}
                </span>
                <span className="text-xs text-slate-500">
                  {selectedActivity.start_time}
                </span>
              </div>
              <h4 className="font-semibold text-slate-900 text-sm">
                {selectedActivity.name}
              </h4>
              <p className="text-xs text-slate-600 mt-1 line-clamp-2">
                {selectedActivity.description}
              </p>
              <div className="mt-2 flex gap-2">
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                    `${selectedActivity.name} ${selectedActivity.address || selectedActivity.location}`
                  )}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-[var(--primary)] hover:underline"
                >
                  Open in Maps
                </a>
                {onActivityClick && (
                  <button
                    onClick={() => {
                      onActivityClick(selectedActivity, selectedActivity.dayNumber);
                      setSelectedActivity(null);
                    }}
                    className="text-xs text-[var(--primary)] hover:underline"
                  >
                    View Details
                  </button>
                )}
              </div>
            </div>
          </InfoWindow>
        )}
      </GoogleMap>
    </div>
  );
}
