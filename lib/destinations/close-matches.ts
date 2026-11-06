/**
 * Misspelled destinations: "KUALUMPUR", "Tailand", "Pariss". The curated list is
 * short and people mean those places far more often than a village with a similar
 * name, so a near miss on it comes before anything an open search would find.
 */

/** How many typing mistakes to forgive: none in a short word, where a few edits make another place. */
function forgivenEdits(length: number): number {
  if (length < 5) return 0;
  return length < 8 ? 1 : 2;
}

/** Edits between two words (insert, delete, change, swap two neighbours), or anything above `max` once it's clear it's more. */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let beforeLast: number[] = [];
  let last = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let edits = Math.min(last[j] + 1, row[j - 1] + 1, last[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        edits = Math.min(edits, beforeLast[j - 2] + 1);
      }
      row.push(edits);
    }
    if (Math.min(...row) > max) return max + 1;
    beforeLast = last;
    last = row;
  }
  return last[b.length];
}

/**
 * The places `typed` looks like a misspelling of: by name, closest first, then
 * every place in a country it looks like, in the order given. Spaces don't count,
 * and `fold` evens out case and accents.
 */
export function closeMatches<T extends { name: string; country: string }>(
  typed: string,
  places: readonly T[],
  fold: (text: string) => string,
): T[] {
  const squash = (text: string) => fold(text).replace(/\s+/g, "");
  const word = squash(typed);
  const max = forgivenEdits(word.length);
  if (max === 0) return [];

  const byName = places
    .map((place) => ({ place, edits: editDistance(word, squash(place.name), max) }))
    .filter(({ edits }) => edits <= max)
    .sort((a, b) => a.edits - b.edits)
    .map(({ place }) => place);
  const byCountry = places.filter((place) => !byName.includes(place) && editDistance(word, squash(place.country), max) <= max);
  return [...byName, ...byCountry];
}
