/**
 * The model's JSON with the slips it makes mid-reply mended, where the parser
 * says exactly where they are: a double quote left unescaped inside a string
 * (`"the "best" view"`), a comma left out between two items (`{…}{…}`), a comma
 * left before the end of an object or a list (`{"a":1,}`, `[1,]`), a stray
 * character or HTML scrap typed before a value (`"type":="market"`,
 * `"address":amp; "Main"`), and a line break or tab typed as it is inside a
 * string. One mend per parse, at the parser's position, so text that parses is
 * never touched. A reply it can't mend throws the parser's first error, and when
 * it mended slips before giving up, the one that stopped it; either carries the
 * text around the slip that stopped it (slipNear), for the logs.
 */

/** The parser's own pointer to the first character it couldn't take. */
const POSITION = /in JSON at position (\d+)/;
/**
 * A token the parser couldn't take, with the text around it and no position:
 * `Unexpected token '=', ..."   "type":="market","... is not valid JSON`. In a
 * long reply the text is cut to ten characters each side of the token.
 */
const AROUND = /^Unexpected token '([^']+)', \.\.\."([\s\S]*)"(?:\.\.\.)? is not valid JSON$/;
const AROUND_BEFORE = 10;
/** More slips than this in one reply is no slip: the reply is broken. */
const MENDS_MAX = 20;
/**
 * A stray run before a string, an object or a list: up to six characters, none of them a quote, a bracket, a
 * comma or a colon. Only before those: a run before a number could be the start of a garbled string, and taking it
 * out would leave the number as the value.
 */
const STRAY_BEFORE_VALUE = /^[^"{}[\],:]{1,6}?(?=\s*["{[])/;

/** How a control character is written inside a JSON string. */
const ESCAPES: Record<string, string> = { "\n": "\\n", "\r": "\\r", "\t": "\\t" };
const escapeOf = (c: string) => ESCAPES[c] ?? `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`;

/**
 * Where the parser stopped: its own position, or, for a token it gives none for,
 * the one place in the text where the ten characters it quotes are followed by
 * that token. Null when that can't be told.
 */
function positionOf(message: string, text: string): number | null {
  const at = POSITION.exec(message);
  if (at) return Number(at[1]);
  const around = AROUND.exec(message);
  if (!around) return null;
  const [, token, quoted] = around;
  const lead = quoted.slice(0, AROUND_BEFORE);
  if (lead.length < AROUND_BEFORE || !quoted.startsWith(token, AROUND_BEFORE)) return null;
  const first = text.indexOf(lead + token);
  if (first < 0 || text.indexOf(lead + token, first + 1) >= 0) return null;
  return first + AROUND_BEFORE;
}

/** The text with the slip at `at` mended, or null when it isn't one of them. */
function mendAt(text: string, at: number): string | null {
  // A line break or another control character inside a string: written as its escape.
  if (at < text.length && text.charCodeAt(at) < 0x20) return `${text.slice(0, at)}${escapeOf(text[at])}${text.slice(at + 1)}`;
  let before = at - 1;
  while (before >= 0 && /\s/.test(text[before])) before--;
  const prev = text[before];
  const next = text[at];
  if (prev === undefined || next === undefined) return null;
  // Two items with nothing between them: `}{`, `""`, `]"`.
  if (/["}\]]/.test(prev) && /["{[]/.test(next)) return `${text.slice(0, before + 1)},${text.slice(before + 1)}`;
  // A comma left before the end of an object or a list.
  if (prev === "," && (next === "}" || next === "]")) return `${text.slice(0, before)}${text.slice(before + 1)}`;
  // A string that ended at a quote inside it, the words going on after it.
  if (prev === '"' && !/[,:\]}]/.test(next)) return `${text.slice(0, before)}\\"${text.slice(before + 1)}`;
  // A stray character or scrap where a value starts: taken out, the value kept.
  if (prev === ":") {
    const stray = STRAY_BEFORE_VALUE.exec(text.slice(at, at + 24));
    if (stray) return `${text.slice(0, at)}${text.slice(at + stray[0].length)}`;
  }
  return null;
}

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Characters each side of a slip in what is logged of it. */
const NEAR = 40;

/** The text around where the parser stopped, marked ⟪ and on one line; null when that can't be told. */
function nearOf(source: string, err: unknown): string | null {
  const at = positionOf(messageOf(err), source);
  if (at === null) return null;
  const near = `${source.slice(Math.max(0, at - NEAR), at)}⟪${source.slice(at, at + NEAR)}`;
  return Array.from(near, (c) => (c.charCodeAt(0) < 0x20 ? escapeOf(c) : c)).join("");
}

/** The text around the slip a reply couldn't be mended past, from mendJson's error; null for any other error. */
export function slipNear(err: unknown): string | null {
  const near = err instanceof Error ? (err as Error & { near?: unknown }).near : undefined;
  return typeof near === "string" ? near : null;
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
      const at = mends < MENDS_MAX ? positionOf(messageOf(err), source) : null;
      const mended = at === null ? null : mendAt(source, at);
      if (mended === null) {
        // Where the reply went wrong first, and what couldn't be mended after the slips before it.
        const stopped = mends === 0 ? first : new SyntaxError(`${messageOf(first)}; ${mends} mended, then: ${messageOf(err)}`);
        const near = nearOf(source, err);
        if (near !== null && stopped instanceof Error) Object.assign(stopped, { near });
        throw stopped;
      }
      source = mended;
    }
  }
}
