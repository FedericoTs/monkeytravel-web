"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslations, useLocale } from "next-intl";
import {
  GoogleMap,
  useJsApiLoader,
  Marker,
  InfoWindow,
  Polyline,
  OverlayView,
} from "@react-google-maps/api";
import type { Activity, ItineraryDay, TimeSlot } from "@/types";
import {
  haversineKm,
  walkingMinutes,
  formatDuration,
  midpoint,
} from "@/lib/map/geo";

// Env flag: gate the per-day polyline + walking-time labels.
// Default OFF until we flip NEXT_PUBLIC_MAP_ROUTES_ENABLED=true on Vercel.
const ROUTES_DEFAULT_ENABLED =
  process.env.NEXT_PUBLIC_MAP_ROUTES_ENABLED === "true";

// Used to sort same-start-time activities into a consistent order.
const TIME_SLOT_ORDER: Record<TimeSlot, number> = {
  morning: 0,
  afternoon: 1,
  evening: 2,
};

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
  /**
   * When true, NO geocoding API calls will be made.
   * Only activities with existing coordinates will show markers.
   * Used for saved trips to ensure zero external API costs.
   */
  disableApiCalls?: boolean;
  /**
   * Draw a polyline per day connecting consecutive activities, with
   * straight-line walking-time labels on each segment. Zero external
   * API calls — uses haversine + a flat speed multiplier. See
   * `lib/map/geo.ts` for the math and the honesty disclaimer.
   *
   * Defaults to NEXT_PUBLIC_MAP_ROUTES_ENABLED so the feature is
   * flag-gated at the env level, but callers can override per-surface.
   */
  showRoutes?: boolean;
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
  selectedDay: selectedDayProp,
  onActivityClick,
  disableApiCalls = false,
  showRoutes: showRoutesProp,
}: TripMapProps) {
  // User-toggleable route visibility. Starts from the prop (or the env
  // flag default) and the in-map toolbar can flip it.
  const [showRoutes, setShowRoutes] = useState<boolean>(
    showRoutesProp ?? ROUTES_DEFAULT_ENABLED
  );
  useEffect(() => {
    if (showRoutesProp !== undefined) {
      setShowRoutes(showRoutesProp);
    }
  }, [showRoutesProp]);
  const locale = useLocale();
  // Internal day-filter state — initialized from the prop but driven by
  // the in-map Day chip clicks below. **2026-05-24 live-test fix:** the
  // Day chip onClick previously only called fitBounds and never updated
  // any filter state, so `filteredActivities` (which depends on
  // selectedDay) was always the full set. UX-wise, the "Days" chip
  // looked like a filter but did nothing to the pins. Now clicking a
  // day toggles the filter (click same day again → clear), and we also
  // fitBounds so the user sees the chosen day's pins zoomed in.
  const [selectedDayInternal, setSelectedDayInternal] = useState<number | null>(
    selectedDayProp ?? null
  );
  // Keep external prop in sync if the parent ever changes it.
  useEffect(() => {
    if (selectedDayProp !== undefined && selectedDayProp !== selectedDayInternal) {
      setSelectedDayInternal(selectedDayProp);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDayProp]);
  const selectedDay = selectedDayInternal;
  const t = useTranslations("common.map");
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

    const processActivities = async () => {
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

          // CRITICAL: If API calls are disabled, skip activities without coordinates
          // They simply won't show on the map - NO API cost
          if (disableApiCalls) {
            // Add activity without location (won't show marker)
            mappedActivities.push({
              ...activity,
              dayNumber: day.day_number,
            });
            continue;
          }

          // Build address for geocoding (only if API calls are allowed)
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
      // ONLY if API calls are enabled
      if (addressesToGeocode.length > 0 && !disableApiCalls) {
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

    processActivities();
  }, [isLoaded, daysHash, destination, days, disableApiCalls]);

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

  /**
   * Per-day ordered routes: for each day visible in the current filter,
   * sort the activities (by time_slot then start_time), keep only those
   * with a resolved location, and emit the consecutive segments.
   *
   * Each segment carries its day color + a pre-computed walking-time
   * label so the render path stays cheap (no math in the JSX).
   */
  const dayRoutes = useMemo(() => {
    if (!showRoutes) return [];

    // Group filtered activities by day for ordering.
    const byDay = new Map<number, MapActivity[]>();
    for (const act of filteredActivities) {
      if (!act.resolvedLocation) continue;
      const bucket = byDay.get(act.dayNumber) ?? [];
      bucket.push(act);
      byDay.set(act.dayNumber, bucket);
    }

    type Segment = {
      key: string;
      from: { lat: number; lng: number };
      to: { lat: number; lng: number };
      mid: { lat: number; lng: number };
      minutes: number;
      color: string;
    };

    type DayRoute = {
      dayNumber: number;
      color: string;
      path: { lat: number; lng: number }[];
      segments: Segment[];
    };

    const result: DayRoute[] = [];

    for (const [dayNumber, acts] of byDay) {
      if (acts.length < 2) continue;

      const sorted = [...acts].sort((a, b) => {
        const slotDiff =
          (TIME_SLOT_ORDER[a.time_slot] ?? 99) -
          (TIME_SLOT_ORDER[b.time_slot] ?? 99);
        if (slotDiff !== 0) return slotDiff;
        return (a.start_time || "").localeCompare(b.start_time || "");
      });

      const color = DAY_COLORS[(dayNumber - 1) % DAY_COLORS.length];
      const path = sorted.map((a) => a.resolvedLocation!) ;
      const segments: Segment[] = [];

      for (let i = 0; i < sorted.length - 1; i++) {
        const from = sorted[i].resolvedLocation!;
        const to = sorted[i + 1].resolvedLocation!;
        const km = haversineKm(from, to);
        // Skip noise: two pins on top of each other don't deserve a "0 min" badge.
        if (km < 0.02) continue;
        segments.push({
          key: `${dayNumber}-${i}`,
          from,
          to,
          mid: midpoint(from, to),
          minutes: walkingMinutes(km, "walking"),
          color,
        });
      }

      result.push({ dayNumber, color, path, segments });
    }

    return result;
  }, [filteredActivities, showRoutes]);

  /**
   * Whether there is at least one day with 2+ geocoded activities — i.e.
   * a route COULD be drawn. We compute this INDEPENDENTLY of `showRoutes`
   * so the in-map toggle button stays visible even when the user has
   * turned routes off (otherwise hiding routes also hides the only way
   * to turn them back on — bug found via live UI test, see task #240).
   */
  const hasRoutablePairs = useMemo(() => {
    const perDay = new Map<number, number>();
    for (const act of filteredActivities) {
      if (!act.resolvedLocation) continue;
      perDay.set(act.dayNumber, (perDay.get(act.dayNumber) || 0) + 1);
    }
    for (const count of perDay.values()) {
      if (count >= 2) return true;
    }
    return false;
  }, [filteredActivities]);

  if (loadError) {
    return (
      <div className={`bg-slate-100 rounded-xl flex items-center justify-center ${className}`}>
        <p className="text-slate-500">{t("failedToLoad")}</p>
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div className={`bg-slate-100 rounded-xl flex items-center justify-center animate-pulse ${className}`}>
        <div className="text-slate-400">{t("loading")}</div>
      </div>
    );
  }

  return (
    <div className={`relative rounded-xl overflow-hidden shadow-lg ${className}`}>
      {isGeocoding && (
        <div className="absolute top-4 left-4 z-10 bg-white/90 backdrop-blur-sm px-3 py-1.5 rounded-full text-sm text-slate-600 shadow-md">
          <span className="inline-block w-2 h-2 bg-[var(--primary)] rounded-full animate-pulse mr-2" />
          {t("loadingLocations")}
        </div>
      )}

      {/* Route toggle + straight-line disclaimer. Only rendered when
          there's at least one multi-pin day to draw a route through —
          no point offering a toggle that does nothing. */}
      {hasRoutablePairs ? (
        <div className="absolute top-3 left-3 z-10 flex items-start gap-2 max-w-[calc(100%-1.5rem)] sm:max-w-xs">
          <button
            type="button"
            onClick={() => setShowRoutes((v) => !v)}
            aria-pressed={showRoutes}
            className="bg-white/95 backdrop-blur-sm rounded-full px-3 py-1.5 text-xs font-medium text-slate-700 shadow-md hover:bg-white active:scale-95 transition-transform flex items-center gap-1.5"
          >
            <span
              className={`inline-block w-2 h-2 rounded-full ${
                showRoutes ? "bg-emerald-500" : "bg-slate-300"
              }`}
              aria-hidden
            />
            {showRoutes ? t("hideRoute") : t("showRoute")}
          </button>
          {showRoutes && dayRoutes.length > 0 && (
            <span className="bg-white/85 backdrop-blur-sm rounded-md px-2 py-1 text-[10px] leading-tight text-slate-500 shadow-sm hidden sm:inline-block">
              {t("disclaimerStraightLine")}
            </span>
          )}
        </div>
      ) : null}

      {/* Day Legend - compact on mobile, detailed on desktop */}
      <div className="absolute bottom-3 left-3 right-3 sm:bottom-auto sm:top-4 sm:left-auto sm:right-4 z-10 bg-white/95 backdrop-blur-sm rounded-lg px-2 py-1.5 sm:p-2 shadow-md max-w-[calc(100%-1.5rem)] sm:max-w-none">
        <div className="text-xs font-medium text-slate-700 mb-1.5 hidden sm:block">{t("days")}</div>
        <div className="flex flex-wrap gap-1 justify-center sm:justify-start">
          {days.map((day) => {
            const isActive = selectedDay === day.day_number;
            return (
              <button
                key={day.day_number}
                title={isActive ? `Show all days` : `Show only Day ${day.day_number}`}
                onClick={() => {
                  // Toggle: clicking the active day clears the filter,
                  // clicking a different day switches to it.
                  const nextSelected = isActive ? null : day.day_number;
                  setSelectedDayInternal(nextSelected);
                  // Always fitBounds — to that day's activities, or to
                  // ALL activities when clearing.
                  const target = nextSelected
                    ? activities.filter(
                        (a) => a.dayNumber === nextSelected && a.resolvedLocation
                      )
                    : activities.filter((a) => a.resolvedLocation);
                  if (target.length > 0 && map) {
                    const bounds = new google.maps.LatLngBounds();
                    target.forEach((a) => {
                      if (a.resolvedLocation) bounds.extend(a.resolvedLocation);
                    });
                    map.fitBounds(bounds, { top: 50, right: 50, bottom: 50, left: 50 });
                  }
                }}
                className={`w-6 h-6 sm:w-6 sm:h-6 rounded-full text-white text-[10px] sm:text-xs font-bold flex items-center justify-center transition-transform hover:scale-110 active:scale-95 ${
                  isActive ? "ring-2 ring-offset-1 ring-slate-900" : ""
                }`}
                style={{
                  backgroundColor: DAY_COLORS[(day.day_number - 1) % DAY_COLORS.length],
                }}
              >
                {day.day_number}
              </button>
            );
          })}
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
        {/* Per-day route polylines + walking-time segment badges.
            Drawn behind the markers (Polyline zIndex defaults below
            Marker), so pins always stay clickable. */}
        {showRoutes &&
          dayRoutes.map((route) => (
            <Polyline
              key={`route-${route.dayNumber}`}
              path={route.path}
              options={{
                strokeColor: route.color,
                strokeOpacity: 0,
                strokeWeight: 0,
                geodesic: false,
                clickable: false,
                icons: [
                  {
                    icon: {
                      path: "M 0,-1 0,1",
                      strokeOpacity: 0.9,
                      strokeWeight: 3,
                      scale: 3,
                    },
                    offset: "0",
                    repeat: "12px",
                  },
                ],
              }}
            />
          ))}

        {showRoutes &&
          dayRoutes.flatMap((route) =>
            route.segments.map((seg) => (
              <OverlayView
                key={`seg-${seg.key}`}
                position={seg.mid}
                mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
                getPixelPositionOffset={(w, h) => ({
                  x: -(w / 2),
                  y: -(h / 2),
                })}
              >
                <div
                  className="pointer-events-none select-none rounded-full bg-white/95 backdrop-blur-sm px-2 py-0.5 text-[10px] font-semibold text-slate-700 shadow-sm border"
                  style={{ borderColor: seg.color }}
                  title={t("segmentDuration", { minutes: seg.minutes })}
                >
                  {formatDuration(seg.minutes, locale)}
                </div>
              </OverlayView>
            ))
          )}

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
                  {t("openInMaps")}
                </a>
                {onActivityClick && (
                  <button
                    onClick={() => {
                      onActivityClick(selectedActivity, selectedActivity.dayNumber);
                      setSelectedActivity(null);
                    }}
                    className="text-xs text-[var(--primary)] hover:underline"
                  >
                    {t("viewDetails")}
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
