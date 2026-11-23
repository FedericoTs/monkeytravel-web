/**
 * Which must-dos a plan holds, by name. Pure and free of the model's client, so
 * the trip page can tell which of a guest's must-dos the plan holds as it is
 * edited; lib/ai/must-dos.ts puts the missing ones in.
 */
import { nameTokens, sameWord } from "@/lib/ai/assistant/saved-activities";

// What kind of thing a must-do is, not which one: "Ichiran ramen" is Ichiran, "Lake Como" is Como.
const KINDS = new Set(
  (
    "temple palace park market museum tower bridge beach castle church cathedral garden village street square lake " +
    "mount mountain island waterfall falls glacier national cave river hill viewpoint observatory building site area " +
    "district center centre old town city quarter shopping shop store mall ramen sushi pizza restaurant cafe coffee bar " +
    "pub bakery hike hiking trek trekking ride boat cruise show concert mercado mercato marche museo museu musee playa " +
    "praia spiaggia plage iglesia chiesa igreja eglise catedral cattedrale parque parco jardin giardino castillo castello " +
    "castelo chateau plaza piazza praca calle rua puente ponte pont torre lago lac monte isla isola ilha"
  ).split(" ")
);
// Words of a wish rather than of a name: "eat good food", "take cute pics".
const NOT_A_NAME = new Set(
  (
    "eat eating good best great nice food foods take cute pics pictures photos photo learn local culture cultural group " +
    "activities activity nature relax relaxing fun nightlife night kids kid family romantic views view sunset sunrise " +
    "sightseeing history historic art arts see try things places place experience experiences authentic traditional " +
    "hidden gems drinks drink party adventure outdoor outdoors day days some lots more many from for into"
  ).split(" ")
);
const isKind = (word: string) =>
  KINDS.has(word) || (word.endsWith("es") && KINDS.has(word.slice(0, -2))) || (word.endsWith("s") && KINDS.has(word.slice(0, -1)));
const notAName = (word: string) => NOT_A_NAME.has(word) || (word.endsWith("s") && NOT_A_NAME.has(word.slice(0, -1)));

/** One must-do per thing: "Buda, temple, capybara cafe" is three. */
function items(mustDos: string[]): string[] {
  return [...new Set(mustDos.flatMap((m) => m.split(/[,;/]|\s[-–]\s/)).map((m) => m.trim()).filter(Boolean))];
}

/** The words that tell a must-do apart; none for a wish ("eat good food") or a kind alone ("museums"). */
function tellingWords(mustDo: string): string[] {
  return nameTokens(mustDo).filter((word) => !isKind(word) && !notAName(word));
}

/** Whether one of these names has every one of the words, a letter off allowed. */
export function held(words: string[], names: string[][]): boolean {
  return names.some((name) => words.every((word) => name.some((n) => sameWord(word, n))));
}

/**
 * Tells a stop the traveller asked for by name from the rest of the plan. The stop's name has to hold the must-do's
 * whole name, a letter off allowed, not only the words that tell it apart: on a London trip those are "London" for
 * the Tower of London, and every stop with London in its name would pass. A wish ("eat good food") or a kind alone
 * ("museums") names none.
 */
export function askedByName(mustDos: string[] | undefined): (stop: { name?: string }) => boolean {
  const asked = items(mustDos ?? [])
    .filter((mustDo) => tellingWords(mustDo).length > 0)
    .map((mustDo) => nameTokens(mustDo));
  return (stop) => asked.some((words) => held(words, [nameTokens(stop.name ?? "")]));
}

/**
 * The must-dos no activity of the plan holds. One is held when an activity's
 * name has every word that tells it apart, a letter off allowed: "gyeongbukgung
 * palace" is Gyeongbokgung Palace. A wish has no such word and is never
 * missing. Pure; unit-tested.
 */
export function missingMustDos(mustDos: string[], days: Array<{ activities?: Array<{ name?: string } | null> }>): string[] {
  const names = days.flatMap((d) => d.activities ?? []).map((a) => nameTokens(a?.name ?? ""));
  return items(mustDos).filter((mustDo) => {
    const words = tellingWords(mustDo);
    return words.length > 0 && !held(words, names);
  });
}
