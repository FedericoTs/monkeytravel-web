import type { Activity, ItineraryDay } from "@/types";

/**
 * Merge an assistant's revised day into the wizard's itinerary: each returned
 * activity takes the id (and coordinates, address, photo when it has none) of
 * the existing activity with the same name.
 *
 * Each existing activity is matched at most once, and every id is unique
 * across the trip. Two entries with the same name ("Free time" twice, going
 * back to the same museum in the evening) used to both get that name's id,
 * and deleting one on the trip page then deleted both. That could only
 * happen once the wizard's own copy carried ids (2026-09-24).
 */
export function mergeDayEditActivities(days: ItineraryDay[], dayNumber: number, newActivities: Activity[]): Activity[] {
  const target = days.find((d) => d.day_number === dayNumber);

  const byName = new Map<string, Activity[]>();
  for (const a of target?.activities ?? []) {
    const key = a.name.trim().toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), a]);
  }

  const used = new Set<string>();
  for (const d of days) {
    if (d.day_number === dayNumber) continue;
    for (const a of d.activities ?? []) if (a?.id) used.add(a.id);
  }
  const unique = (id: string) => {
    let out = id;
    for (let n = 2; used.has(out); n++) out = `${id}-${n}`;
    used.add(out);
    return out;
  };

  return newActivities.map((a, i) => {
    const match = byName.get(a.name.trim().toLowerCase())?.shift();
    const fresh = `edit-${dayNumber}-${i}-${a.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, 40)}`;
    const candidate = match?.id ?? a.id;
    return {
      ...a,
      id: unique(candidate && !used.has(candidate) ? candidate : fresh),
      coordinates: a.coordinates ?? match?.coordinates,
      address: a.address ?? match?.address,
      image_url: a.image_url ?? match?.image_url,
    };
  });
}
