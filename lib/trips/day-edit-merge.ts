import { addDaysISO } from "@/lib/ai/multi-city-core";
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

/** One day of an assistant reply: the day's full new activity list. */
export interface AssistantDayEdit {
  day_number: number;
  activities: Activity[];
  theme?: string;
  /** Multi-city trips: the city this day now takes place in. */
  city?: string;
}

/**
 * Apply one assistant reply to the itinerary: several days at once (a move or
 * a swap changes two), and optionally a new trip length, which adds days at
 * the end or drops trailing ones.
 *
 * WHY (2026-09-26): the wizard's assistant could only return one day, so
 * "switch the northern lights to day 5 and orca watching to day 2" came back
 * as a Day 2 edit with a reply claiming the swap, and "add one more day" or
 * "Quito 2 nights, Baños 1, Galápagos 3" could not be done at all. People
 * regenerated the whole trip instead and lost their edits.
 *
 * Ids and place data (coordinates, address, photo) are pooled across ALL the
 * edited days, not just the same day, so an activity moved from Day 5 to
 * Day 2 keeps its id and its photo. Each existing activity is reused at most
 * once and every id stays unique across the trip, as in mergeDayEditActivities.
 */
export function applyAssistantEdits(
  days: ItineraryDay[],
  edits: AssistantDayEdit[],
  opts: { tripLength?: number; startDate?: string } = {}
): ItineraryDay[] {
  const ordered = [...days].sort((a, b) => a.day_number - b.day_number);
  const length = Math.max(1, Math.round(opts.tripLength ?? ordered.length));
  const first = ordered[0];
  const start = opts.startDate || first?.date;
  const last = ordered[ordered.length - 1];

  // Resize: keep days 1..length, add empty days for the ones an edit fills.
  const resized: ItineraryDay[] = [];
  for (let n = 1; n <= length; n++) {
    const existing = ordered.find((d) => d.day_number === n);
    if (existing) resized.push(existing);
    else
      resized.push({
        day_number: n,
        date: start ? addDaysISO(start, n - 1) : "",
        activities: [],
        ...(last?.city ? { city: last.city } : {}),
      });
  }

  const editByDay = new Map<number, AssistantDayEdit>();
  for (const e of edits) if (e.day_number >= 1 && e.day_number <= length) editByDay.set(e.day_number, e);
  if (editByDay.size === 0) return resized;

  // Existing activities of every edited day, by name, in trip order.
  const groups = new Map<string, Activity[]>();
  for (const d of ordered) {
    if (!editByDay.has(d.day_number)) continue;
    for (const a of d.activities ?? []) {
      if (!a || typeof a !== "object") continue;
      const key = nameKey(a);
      groups.set(key, [...(groups.get(key) ?? []), a]);
    }
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

  // Ids already used by the days nobody is editing.
  const used = new Set<string>();
  for (const d of resized) {
    if (editByDay.has(d.day_number)) continue;
    for (const a of d.activities ?? []) if (a?.id) used.add(a.id);
  }
  const unique = (id: string) => {
    let out = id;
    for (let n = 2; used.has(out); n++) out = `${id}-${n}`;
    used.add(out);
    return out;
  };

  // Pair every new activity first, across all edited days, and reserve the
  // ids those pairs keep, so a fresh id handed out below can never take one.
  const editedDays = [...editByDay.keys()].sort((a, b) => a - b);
  const donors = new Map<number, (Activity | undefined)[]>();
  const kept = new Map<number, (string | null)[]>();
  for (const n of editedDays) {
    const pairs = editByDay.get(n)!.activities.map((a) => pick(a));
    donors.set(n, pairs);
    kept.set(
      n,
      pairs.map((m) => {
        if (!m?.id || used.has(m.id)) return null;
        used.add(m.id);
        return m.id;
      })
    );
  }

  const merged = new Map<number, Activity[]>();
  for (const n of editedDays) {
    const edit = editByDay.get(n)!;
    const pairs = donors.get(n)!;
    const keeps = kept.get(n)!;
    merged.set(
      n,
      edit.activities.map((a, i) => {
        const donor = pairs[i] ?? groups.get(nameKey(a))?.[0];
        const fresh = `edit-${n}-${i}-${nameKey(a)
          .replace(/[^a-z0-9]+/g, "-")
          .slice(0, 40)}`;
        return {
          ...a,
          id: keeps[i] ?? unique(a.id && !used.has(a.id) ? a.id : fresh),
          coordinates: a.coordinates ?? donor?.coordinates,
          address: a.address ?? donor?.address,
          image_url: a.image_url ?? donor?.image_url,
        };
      })
    );
  }

  return resized.map((d) => {
    const edit = editByDay.get(d.day_number);
    if (!edit) return d;
    return {
      ...d,
      activities: merged.get(d.day_number)!,
      ...(edit.theme ? { theme: edit.theme } : {}),
      ...(edit.city ? { city: edit.city } : {}),
    };
  });
}
