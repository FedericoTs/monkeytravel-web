/**
 * The letters of a place for the story's guess: how the board lays the name out, and which key opens each
 * letter. A friend picks from A to Z, so "São Paulo" answers to S, A, O, P, U and L: an accent is the board's to
 * show, not the friend's to type.
 */

export const KEYS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

/** Wrong letters a friend may pick before the place is shown. */
export const GUESS_MISSES = 6;
/** How many wrong letters it takes for each clue to show: the first is there from the start. */
export const CLUE_AFTER_MISSES = [0, 1, 2, 4];

/** The key that opens a character, or null for what stays in sight: a space, a hyphen, a letter no key has. */
export function keyOf(ch: string): string | null {
  const base = ch.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase();
  return /^[A-Z]$/.test(base) ? base : null;
}

export interface BoardTile {
  /** The character as the place writes it, in capitals. */
  ch: string;
  /** The key that opens it; null when it is in sight from the start. */
  key: string | null;
}

/** The place as the board shows it: a row of tiles for each of its words. */
export function boardOf(place: string, locale: string): BoardTile[][] {
  return place
    .trim()
    .split(/\s+/)
    .map((word) => [...word.toLocaleUpperCase(locale)].map((ch) => ({ ch, key: keyOf(ch) })));
}

/** The keys that open the whole place. */
export function keysOf(place: string): Set<string> {
  return new Set([...place].map(keyOf).filter((key): key is string => key !== null));
}

/** Where a guess stands, from the keys picked so far. */
export function guessState(place: string, picked: readonly string[], allowed: number): { misses: number; solved: boolean; lost: boolean } {
  const answer = keysOf(place);
  const misses = picked.filter((key) => !answer.has(key)).length;
  const solved = [...answer].every((key) => picked.includes(key));
  return { misses, solved, lost: !solved && misses >= allowed };
}

/** How many clues are in sight after `misses` wrong letters: `after` says how many it takes for each. */
export function cluesInSight(total: number, misses: number, after: readonly number[]): number {
  let shown = 0;
  for (let i = 0; i < total; i += 1) {
    if (misses >= (after[i] ?? after[after.length - 1])) shown = i + 1;
  }
  return shown;
}
