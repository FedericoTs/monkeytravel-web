import type { Activity, ItineraryDay } from "@/types";

/**
 * Merge an assistant's revised day into the wizard's itinerary. The
 * assistant's activities carry no id, coordinates, address or photo, so they
 * are taken from the existing activities of that day with the same name.
 *
 * - Ids: each existing activity's id goes to at most one new activity, and
 *   every id is unique across the trip. Two same-named entries ("Free time"
 *   twice, going back to the same museum in the evening) used to share one
 *   id, and deleting one on the trip page then deleted both. That became
 *   reachable once the wizard's own copy carried ids (2026-09-24).
 * - Within a same-name group, a new activity is paired with the unused
 *   existing one whose start time is closest (so dropping the morning "Free
 *   time" keeps the evening one's id and place), else the first unused one.
 * - Place data (coordinates, address, photo) still comes from a same-named
 *   activity even when its id is already taken: a revisit is the same place.
 */

const nameKey = (a: Activity) => (typeof a.name === "string" ? a.name : "").trim().toLowerCase();

function minutes(time: unknown): number | null {
  if (typeof time !== "string") return null;
  const m = time.match(/^(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function mergeDayEditActivities(days: ItineraryDay[], dayNumber: number, newActivities: Activity[]): Activity[] {
  const target = days.find((d) => d.day_number === dayNumber);

  // Existing activities of the day, by name, in day order.
  const groups = new Map<string, Activity[]>();
  for (const a of target?.activities ?? []) {
    if (!a || typeof a !== "object") continue;
    const key = nameKey(a);
    groups.set(key, [...(groups.get(key) ?? []), a]);
  }
  const taken = new Set<Activity>();

  const pick = (a: Activity): Activity | undefined => {
    const candidates = (groups.get(nameKey(a)) ?? []).filter((c) => !taken.has(c));
    if (candidates.length === 0) return undefined;
    const want = minutes(a.start_time);
    let best = candidates[0];
    if (want !== null) {
      let bestGap = Infinity;
      for (const c of candidates) {
        const at = minutes(c.start_time);
        const gap = at === null ? Infinity : Math.abs(at - want);
        if (gap < bestGap) {
          best = c;
          bestGap = gap;
        }
      }
    }
    taken.add(best);
    return best;
  };

  // Pass 1: pair every new activity first, so a fresh id handed out below can
  // never take an id a later pair keeps.
  const matches = newActivities.map((a) => pick(a));

  const used = new Set<string>();
  for (const d of days) {
    if (d.day_number === dayNumber) continue;
    for (const a of d.activities ?? []) if (a?.id) used.add(a.id);
  }
  const kept = matches.map((m) => {
    if (!m?.id || used.has(m.id)) return null;
    used.add(m.id);
    return m.id;
  });
  const unique = (id: string) => {
    let out = id;
    for (let n = 2; used.has(out); n++) out = `${id}-${n}`;
    used.add(out);
    return out;
  };

  return newActivities.map((a, i) => {
    const donor = matches[i] ?? groups.get(nameKey(a))?.[0];
    const fresh = `edit-${dayNumber}-${i}-${nameKey(a)
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, 40)}`;
    return {
      ...a,
      id: kept[i] ?? unique(a.id && !used.has(a.id) ? a.id : fresh),
      coordinates: a.coordinates ?? donor?.coordinates,
      address: a.address ?? donor?.address,
      image_url: a.image_url ?? donor?.image_url,
    };
  });
}
