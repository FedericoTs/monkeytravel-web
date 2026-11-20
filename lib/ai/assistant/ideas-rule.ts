import type { ItineraryDay } from "@/types";
import type { AssistTurn } from "./edit-prompt";

/**
 * How the trip-page assistants offer ideas: for this trip, and never again
 * once turned down. A traveller who said "none of those" to three museums was
 * offered the same three again when they asked for something indoors, then
 * more of the same; they gave up. The edit engine (edit-prompt.ts) and the
 * chat (chat-prompt.ts) both carry this rule, and the engine checks its answer
 * against it (offeredAgain).
 */
export const IDEAS_RULE =
  `Ideas you offer fit this trip: who's travelling and why (a group celebrating, children, a diet), the kind of places already in their plan, and what they've asked for so far. ` +
  `Places they turned down ("none of those", "boring", "something else") stay out for the rest of the conversation, however they ask next ("anything indoors?"): never offer them again, nor anything already in their plan. ` +
  `Offer a different kind of thing instead, and end with one short question about what they'd enjoy, so the next ideas fit.`;

// A message that opens by turning down what was just offered, in the four
// languages, after an optional "no". "Swap the mall for something else" asks
// for a change to the plan and doesn't open this way.
const OPENS_TURNING_DOWN = new RegExp(
  "^(?:(?:no|nope|nah|meh)\\b[\\s,.!…-]*)?(?:" +
    [
      "none of (?:those|these|them|that)",
      "neither",
      "not (?:those|these|them|that|really|for (?:me|us))",
      "no thanks",
      "(?:something|anything) else",
      "other (?:ideas|options|ones|suggestions|places)",
      "ningun[oa]",
      "nada de eso",
      "otra cosa",
      "otras (?:opciones|ideas|cosas)",
      "nessun[oa]",
      "niente di (?:tutto )?questo",
      "qualcos['’ ]?altro",
      "qualcosa d['’ ]?altro",
      "altre (?:idee|opzioni|proposte)",
      "nenhum[a]?",
      "nada disso",
      "outra coisa",
      "outras (?:opções|ideias|sugestões)",
    ].join("|") +
    ")",
  "i",
);
const BORING = /\b(?:boring|aburrid[oa]s?|noios[oiea]|chat[oa]s?)\b/i;
const SHORT_WORDS = 10;

/** Whether the traveller's message turns down what the assistant just offered. */
export function turnsDown(message: string): boolean {
  const text = message.trim();
  return OPENS_TURNING_DOWN.test(text) || (BORING.test(text) && text.split(/\s+/).length <= SHORT_WORDS);
}

/** For each turn, whether it's a reply the traveller turned down: by their next message, or by the new one after the last. */
export function turnedDown(turns: AssistTurn[], message: string): boolean[] {
  return turns.map((t, i) => {
    if (t.role !== "assistant") return false;
    const next = i === turns.length - 1 ? message : turns[i + 1].role === "user" ? turns[i + 1].text : "";
    return turnsDown(next);
  });
}

// Words of a reply, and the punctuation that ends a name.
const TOKENS = /[\p{L}\p{N}'’]+|[^\s\p{L}\p{N}'’]/gu;
// Words inside a name: "Garden and Glass", "Castelo de São Jorge", and an
// article after "of" ("Museum of the Moving Image"). "Try the Tile Museum" is
// a verb before a name, and "the Pink Door and the Tile Museum" two names.
const AND = /^(?:and|e|y|&)$/i;
const OF = /^(?:of|de|del|di|della|delle|dei|da|do|dos|das)$/i;
const ARTICLES = /^(?:the|la|las|los|el|il|lo|le|gli|o|a|os|as)$/i;
const SENTENCE_END = /^[.!?:;]$/;
const CAPITAL = /^\p{Lu}/u;
const CAPITAL_INSIDE = /^\p{L}+\p{Lu}/u;
const CALENDAR = /^(?:day|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december)$/i;

const capitalsOf = (words: string[]) => words.filter((w) => CAPITAL.test(w));

// A run less its joining words at either end, and less an article before two
// capitalised words: "The Pink Door" is also "Pink Door", as a later reply may write it.
function trim(words: string[]): string[] {
  let from = 0;
  let to = words.length;
  while (from < to && (AND.test(words[from]) || OF.test(words[from]))) from++;
  while (to > from && (AND.test(words[to - 1]) || OF.test(words[to - 1]) || ARTICLES.test(words[to - 1]))) to--;
  const kept = words.slice(from, to);
  return ARTICLES.test(kept[0] ?? "") && capitalsOf(kept.slice(1)).length >= 2 ? kept.slice(1) : kept;
}

/**
 * The places a reply names: runs of capitalised words ("Chihuly Garden and
 * Glass", "Museum of Pop Culture") and one-word names with a capital inside
 * ("MoPOP"). A run made only of words of the destination or calendar words
 * isn't one. A run that opens a sentence may start with a verb ("Visiting Tile
 * Museum"), so it also counts without its first word; one joined by "and"
 * also counts as each of its parts.
 */
export function placeNames(text: string, destination = ""): string[] {
  const own = new Set((destination.match(/\p{L}+/gu) ?? []).map((w) => w.toLowerCase()));
  const tokens = text.match(TOKENS) ?? [];
  const names: string[] = [];
  const add = (words: string[]) => {
    const capitals = capitalsOf(words).map((w) => w.replace(/['’]s$/, ""));
    const named = capitals.length >= 2 || (capitals.length === 1 && CAPITAL_INSIDE.test(capitals[0]));
    const ownOnly = capitals.every((w) => own.has(w.toLowerCase()) || CALENDAR.test(w));
    if (named && !ownOnly) names.push(words.join(" ").replace(/['’]s$/, ""));
  };
  let run: string[] = [];
  let opensSentence = true;
  let runOpensSentence = false;
  const close = () => {
    const words = trim(run);
    add(words);
    if (runOpensSentence && capitalsOf(words).length >= 3) add(trim(words.slice(1)));
    const parts: string[][] = [[]];
    for (const w of words) {
      if (AND.test(w)) parts.push([]);
      else parts[parts.length - 1].push(w);
    }
    if (parts.length > 1) parts.forEach((part) => add(trim(part)));
    run = [];
  };
  for (const token of tokens) {
    if (CAPITAL.test(token)) {
      if (run.length === 0) runOpensSentence = opensSentence;
      run.push(token);
    } else if (run.length > 0 && (AND.test(token) || OF.test(token) || (ARTICLES.test(token) && OF.test(run[run.length - 1])))) {
      run.push(token);
    } else {
      close();
    }
    opensSentence = SENTENCE_END.test(token);
  }
  close();
  return [...new Set(names)];
}

const mentions = (text: string, name: string) =>
  new RegExp(`(?<![\\p{L}\\p{N}])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "iu").test(text);

/**
 * The places of replies the traveller turned down that this answer offers
 * again, in its reply or as a new stop. Places already in the plan are only
 * mentioned, not offered, and one the new message asks about ("add the pop
 * culture museum after all") is theirs to have.
 */
export function offeredAgain(
  input: { message: string; history?: AssistTurn[]; days: ItineraryDay[]; destination?: string },
  answer: { reply: string; edits: { activities: { name: string }[] }[] },
): string[] {
  const turns = input.history ?? [];
  const down = turnedDown(turns, input.message);
  const planned = input.days.flatMap((d) => d.activities.map((a) => a.name));
  const own = new Set((input.destination?.match(/\p{L}+/gu) ?? []).map((w) => w.toLowerCase()));
  const askedFor = (name: string) =>
    (name.match(/\p{L}{4,}/gu) ?? []).some((w) => !own.has(w.toLowerCase()) && mentions(input.message, w));
  const names = turns
    .filter((_, i) => down[i])
    .flatMap((t) => placeNames(t.text, input.destination))
    .filter((n) => !planned.some((p) => mentions(p, n) || mentions(n, p)) && !askedFor(n));
  const added = answer.edits.flatMap((e) => e.activities.map((a) => a.name)).filter((n) => !planned.includes(n));
  const said = [answer.reply, ...added].join("\n");
  const hits = [...new Set(names.filter((n) => mentions(said, n)))];
  // "Chihuly Garden" is said with "Chihuly Garden and Glass": name the whole.
  return hits.filter((h) => !hits.some((o) => o !== h && mentions(o, h)));
}
