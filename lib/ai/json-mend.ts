/**
 * The model's JSON with the two slips it makes mid-reply mended, where the
 * parser says exactly where they are: a double quote left unescaped inside a
 * string (`"the "best" view"`) and a comma left out between two items
 * (`{…}{…}`). One mend per parse, at the parser's position, so text that
 * parses is never touched. Anything else is thrown as JSON.parse throws it.
 */

/** The parser's own pointer to the first character it couldn't take. */
const POSITION = /in JSON at position (\d+)/;
/** More slips than this in one reply is no slip: the reply is broken. */
const MENDS_MAX = 20;

/** The text with the slip at `at` mended, or null when it isn't one of the two. */
function mendAt(text: string, at: number): string | null {
  let before = at - 1;
  while (before >= 0 && /\s/.test(text[before])) before--;
  const prev = text[before];
  const next = text[at];
  if (prev === undefined || next === undefined) return null;
  // Two items with nothing between them: `}{`, `""`, `]"`.
  if (/["}\]]/.test(prev) && /["{[]/.test(next)) return `${text.slice(0, before + 1)},${text.slice(before + 1)}`;
  // A string that ended at a quote inside it, the words going on after it.
  if (prev === '"' && !/[,:\]}]/.test(next)) return `${text.slice(0, before)}\\"${text.slice(before + 1)}`;
  return null;
}

/** The parsed value and how many slips were mended to get it; JSON.parse's first error when it can't be. */
export function mendJson(text: string): { value: unknown; mends: number } {
  let source = text;
  let first: unknown = null;
  for (let mends = 0; ; mends++) {
    try {
      return { value: JSON.parse(source), mends };
    } catch (err) {
      first ??= err;
      const at = POSITION.exec(err instanceof Error ? err.message : "");
      const mended = at && mends < MENDS_MAX ? mendAt(source, Number(at[1])) : null;
      if (mended === null) throw first;
      source = mended;
    }
  }
}
