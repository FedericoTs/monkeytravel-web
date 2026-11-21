/**
 * A place name typed all in lower case, written the way the place is written:
 * "kyoto" is "Kyoto", "monaco di baviera" is "Monaco di Baviera". The cities of
 * a route become the plan's day headings and its transfer cards, so "Train to
 * kyoto" would read as the planner's slip. A name typed with any capital stays
 * as the traveller wrote it.
 */

/** The small words inside a name: of, de, di, do, am, en, upon... Small unless the name starts with them. */
const SMALL_WORDS = new Set([
  "of", "the", "and", "upon", "on", "in", "at",
  "de", "del", "la", "las", "los", "y",
  "di", "della", "dello", "dei", "degli", "delle", "da", "dal", "dalla", "e", "sul", "sulla", "al", "alla",
  "do", "dos", "das",
  "du", "des", "le", "les", "sur", "en", "et", "aux",
  "am", "an", "der", "im", "ob", "bei",
  "aan", "den", "op",
]);

/** Articles that join the next word with an apostrophe: d'Ampezzo, nell'Emilia. */
const ELIDED = new Set(["d", "l", "dell", "dall", "nell", "sull", "all"]);

/** Short forms written in capitals. */
const SHORT_FORMS = new Set(["dc", "uk", "usa", "uae", "nyc"]);

const capitalise = (part: string) => part.charAt(0).toUpperCase() + part.slice(1);

function tidyWord(word: string, first: boolean): string {
  if (SHORT_FORMS.has(word)) return word.toUpperCase();
  if (!first && SMALL_WORDS.has(word)) return word;
  const parts = word.split(/(['’])/);
  return parts
    .map((part, i) => {
      if (part === "'" || part === "’" || part === "") return part;
      return i === 0 && !first && parts.length > 1 && ELIDED.has(part) ? part : capitalise(part);
    })
    .join("");
}

export function tidyTypedPlace(text: string): string {
  const name = text.trim().replace(/\s+/g, " ");
  if (name !== name.toLowerCase()) return name;
  // The start of the name, or of the part after a comma ("la paz, bolivia").
  let start = true;
  return name
    .split(/(\s|,|-|\/)/)
    .map((piece) => {
      if (piece === ",") {
        start = true;
        return piece;
      }
      if (piece === "" || /^[\s\-/]$/.test(piece)) return piece;
      const word = tidyWord(piece, start);
      start = false;
      return word;
    })
    .join("");
}
