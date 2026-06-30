"use client";

/**
 * Multi-city trip — preview surface (Phase 2, multi-city wedge).
 *
 * A focused, self-contained UI for the per-city parallel generator
 * (lib/ai/multi-city via /api/ai/generate with a `destinations` array). It
 * exists to exercise the engine end-to-end through a real browser before the
 * full wizard integration (route-builder rows + Journey ribbon) lands. Anyone
 * can generate (anonymous generation is allowed); saving comes with the wizard
 * integration.
 */

import { useState } from "react";
import type { GeneratedItinerary, ItineraryDay } from "@/types";
import { JourneyRibbon } from "@/components/trips/JourneyRibbon";
import { MultiCityRouteBuilder, type RouteStop } from "@/components/trips/MultiCityRouteBuilder";

function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDaysISO(startISO: string, days: number): string {
  const d = new Date(`${startISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function joinCities(cities: string[]): string {
  if (cities.length <= 1) return cities[0] ?? "";
  if (cities.length === 2) return `${cities[0]} & ${cities[1]}`;
  return `${cities.slice(0, -1).join(", ")} & ${cities[cities.length - 1]}`;
}

function defaultStart(): string {
  const d = new Date();
  d.setDate(d.getDate() + 14); // safely in the future
  return toISO(d);
}

export default function MultiCityPreviewPage() {
  const [rows, setRows] = useState<RouteStop[]>([
    { city: "Rome", nights: 3 },
    { city: "Paris", nights: 2 },
  ]);
  const [startDate, setStartDate] = useState<string>(defaultStart());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [itinerary, setItinerary] = useState<GeneratedItinerary | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);

  const legs = rows.filter((r) => r.city.trim() && r.nights > 0);
  const totalNights = legs.reduce((s, r) => s + r.nights, 0);

  async function generate() {
    setLoading(true);
    setError(null);
    setItinerary(null);
    setElapsed(null);
    const t0 = Date.now();
    try {
      if (legs.length < 2) {
        setError("Add at least two cities.");
        return;
      }
      if (totalNights > 14) {
        setError(`Trips are capped at 14 days — you have ${totalNights} nights.`);
        return;
      }
      const cities = legs.map((r) => r.city.trim());
      const endDate = addDaysISO(startDate, totalNights - 1);
      const res = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          destination: joinCities(cities),
          startDate,
          endDate,
          budgetTier: "balanced",
          pace: "moderate",
          vibes: ["cultural"],
          interests: [],
          destinations: legs.map((r) => ({ city: r.city.trim(), nights: r.nights })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(
          data?.error?.message || data?.message || data?.error || `Request failed (${res.status})`
        );
        return;
      }
      setItinerary(data.itinerary as GeneratedItinerary);
      setElapsed(Date.now() - t0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  // Group the merged days by their city tag, preserving order.
  const cityGroups: { city: string; days: ItineraryDay[] }[] = [];
  if (itinerary) {
    for (const day of itinerary.days) {
      const key = day.city || "—";
      const last = cityGroups[cityGroups.length - 1];
      if (last && last.city === key) last.days.push(day);
      else cityGroups.push({ city: key, days: [day] });
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <header className="mb-6">
        <span className="inline-block rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
          Preview
        </span>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">Multi-city trip</h1>
        <p className="mt-1 text-sm text-slate-600">
          Plan one trip across several cities — each city is generated independently and
          stitched into a single day-by-day itinerary.
        </p>
      </header>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <MultiCityRouteBuilder rows={rows} onChange={setRows} />

        <div className="mt-5 flex flex-wrap items-end gap-4 border-t border-slate-100 pt-4">
          <label className="text-sm">
            <span className="mb-1 block font-medium text-slate-700">Start date</span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
            />
          </label>
          <div className="text-sm text-slate-600">
            <span className="font-medium text-slate-900">{totalNights}</span> nights ·{" "}
            <span className="font-medium text-slate-900">{legs.length}</span> cities
          </div>
          <button
            type="button"
            onClick={generate}
            disabled={loading}
            className="ml-auto rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Generating…" : "Generate trip"}
          </button>
        </div>
      </section>

      {error && (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {loading && (
        <p className="mt-6 text-center text-sm text-slate-500">
          Generating {legs.length} cities in parallel — this can take a minute…
        </p>
      )}

      {itinerary && (
        <section className="mt-8">
          <div className="mb-4">
            <h2 className="text-xl font-bold text-slate-900">{itinerary.destination.name}</h2>
            <p className="text-sm text-slate-500">
              {itinerary.days.length} days
              {elapsed != null && ` · generated in ${(elapsed / 1000).toFixed(1)}s`}
              {itinerary.trip_summary?.total_estimated_cost
                ? ` · est. ${itinerary.trip_summary.currency} ${itinerary.trip_summary.total_estimated_cost}`
                : ""}
            </p>
          </div>

          <JourneyRibbon
            stops={cityGroups.map((g) => ({ city: g.city, nights: g.days.length }))}
            className="mb-6"
          />

          <div className="space-y-6">
            {cityGroups.map((group, gi) => (
              <div key={gi}>
                <div className="mb-2 flex items-center gap-2">
                  <h3 className="text-base font-bold text-slate-900">{group.city}</h3>
                  <span className="text-xs text-slate-500">{group.days.length} nights</span>
                </div>
                <ol className="space-y-2">
                  {group.days.map((day) => (
                    <li
                      key={day.day_number}
                      className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-3"
                    >
                      <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-700">
                        {day.day_number}
                      </span>
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-slate-900">
                          {day.title || day.theme || `Day ${day.day_number}`}
                          {day.city && (
                            <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-normal text-slate-500">
                              {day.city}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-500">
                          {day.date} · {day.activities?.length ?? 0} activities
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
