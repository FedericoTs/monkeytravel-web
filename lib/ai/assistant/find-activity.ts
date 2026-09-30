import type { Activity, ItineraryDay } from "@/types";

/**
 * Finding the activity a trip-assistant message names ("remove uluwatu
 * temple", "replace teamlab planet"). People type names loosely: partly,
 * without accents, with a typo. A near miss used to answer "could not find"
 * and ask for the exact name, which the person then had to go and copy.
 */

export interface FoundActivity {
  activity: Activity;
  dayIndex: number;
  activityIndex: number;
}

interface Scored extends FoundActivity {
  score: number;
}

/** The score a best match needs; a lower one is a guess, not a match. */
const MATCH_SCORE = 40;

function clean(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[&.,'’()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(the|a|an|visit|go to|see|explore)\s+/i, "")
    .replace(/\s+(visit|tour|experience|activity)$/i, "")
    .trim();
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[b.length];
}

/** One word contains the other, or they are the same word with a typo. */
function wordsMatch(search: string, name: string): boolean {
  if (name.includes(search) || search.includes(name)) return true;
  const shorter = Math.min(search.length, name.length);
  if (shorter < 4) return false;
  return editDistance(search, name) <= (shorter >= 8 ? 2 : 1);
}

function score(search: string, name: string): number {
  if (!search || !name) return 0;
  if (name === search) return 100;
  if (name.includes(search)) return 80;
  if (search.includes(name)) return 70;
  const searchWords = search.split(" ");
  const nameWords = name.split(" ");
  const matched = searchWords.filter((sw) => nameWords.some((nw) => wordsMatch(sw, nw)));
  return (matched.length / searchWords.length) * 60;
}

function scoreAll(itinerary: ItineraryDay[], searchName: string, dayNumber?: number): Scored[] {
  const search = clean(searchName);
  const scored: Scored[] = [];
  itinerary.forEach((day, dayIndex) => {
    if (dayNumber !== undefined && (day.day_number ?? dayIndex + 1) !== dayNumber) return;
    day.activities.forEach((activity, activityIndex) => {
      scored.push({ activity, dayIndex, activityIndex, score: score(search, clean(activity.name ?? "")) });
    });
  });
  return scored;
}

/** The activity a message names, searching only `dayNumber` when the user named a day. */
export function findActivityByName(
  itinerary: ItineraryDay[],
  searchName: string,
  dayNumber?: number,
): FoundActivity | null {
  let best: Scored | null = null;
  for (const candidate of scoreAll(itinerary, searchName, dayNumber)) {
    if (!best || candidate.score > best.score) best = candidate;
  }
  if (!best || best.score < MATCH_SCORE) {
    console.log(`[AI Assistant] No matching activity found for "${searchName}"`);
    return null;
  }
  console.log(`[AI Assistant] Best match: "${best.activity.name}" with score ${best.score}`);
  return { activity: best.activity, dayIndex: best.dayIndex, activityIndex: best.activityIndex };
}

/**
 * Why nothing matched, with the names the person can pick from: the nearest
 * partial matches, or the named day's activities when nothing is close.
 */
export function activityNotFoundReason(itinerary: ItineraryDay[], searchName: string, dayNumber?: number): string {
  const scored = scoreAll(itinerary, searchName, dayNumber);
  const near = scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  const names = (near.length > 0 || dayNumber === undefined ? near : scored.slice(0, 8)).map((s) => `"${s.activity.name}"`);
  const where = dayNumber ? `on Day ${dayNumber}` : "in your itinerary";
  const base = `Could not find an activity matching "${searchName}" ${where}`;
  if (names.length === 0) return base;
  return `${base}. ${near.length > 0 ? "The closest names are" : "That day has"} ${names.join(", ")}: offer them by name.`;
}
