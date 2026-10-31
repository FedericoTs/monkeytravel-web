import { SUPPORTED_CURRENCIES } from "@/lib/locale/currency";

/**
 * "Convert the budget to euros", "add euro sign everywhere": the planner wants
 * prices shown in another currency. The model cannot change that and used to
 * reply "already in euros" while every amount still read "$". The page shows
 * prices in the viewer's preferred currency, so the request is answered by
 * switching that preference (AnonAssistantPanel), not by an itinerary edit.
 */

// Letters and digits in any script: a plain \b breaks on accented words.
const B = "(?<![\\p{L}\\p{N}])";
const E = "(?![\\p{L}\\p{N}])";

// What people call a currency, most specific first ("canadian dollars" before "dollars").
const NAMES: Array<[string, string]> = [
  ["CAD", "canadian\\s+dollars?|d[oó]lar(?:es)?\\s+canadienses?"],
  ["AUD", "australian\\s+dollars?|d[oó]lar(?:es)?\\s+australianos?"],
  ["MXN", "mexican\\s+pesos?|pesos?\\s+mexicanos?"],
  ["CHF", "swiss\\s+francs?|francos?\\s+suizos?|franchi\\s+svizzeri|francos?\\s+su[ií]ços?"],
  ["EUR", "euros?|€"],
  ["USD", "us\\s*dollars?|dollars?|d[oó]lar(?:es)?|dollari|us\\$|\\$"],
  ["GBP", "pounds?(?:\\s+sterling)?|sterling|sterlin[ae]|libras?(?:\\s+esterlinas?)?|£"],
  ["JPY", "yen(?:es)?|¥"],
  ["INR", "rupees?|rupias?|rupie|₹"],
  ["BRL", "reais|r\\$"],
];

const CURRENCY = [...NAMES.map(([, words]) => words), SUPPORTED_CURRENCIES.join("|")].join("|");
const ARTICLE = "(?:(?:the|el|los|las|il|lo|la|i|gli|le|o|os|as)\\s+)?";

/** A reason to read the message as a display request at all. */
const INTENT = new RegExp(
  `${B}(?:convert\\p{L}*|change|switch|show|display|put|use|set|make|turn|want|give|see|currency|currencies|` +
    `convier\\p{L}*|cambia\\p{L}*|muestr\\p{L}*|mostr\\p{L}*|pon|poner|pasa\\p{L}*|moneda|divisa|` +
    `metti|mettere|valuta|mude|mudar|coloque|colocar|passe|passar|troque|trocar|moeda|` +
    `prices?|costs?|budget|amounts?|estimates?|precios?|costos?|costes?|presupuesto|importes?|prezzi|costi|importi|preços|custos|orçamento|valores|` +
    `sign|symbol|s[ií]mbolo|signo|segno|sinal)${E}`,
  "iu"
);

/** Where the target currency sits: after "to/in/into" and their equivalents, or as the sign to add. */
const TARGETS = [
  new RegExp(`${B}(?:to|into|in|a|al|en|para|pra|em|nel|nella)\\s+${ARTICLE}(?<cur>${CURRENCY})${E}`, "giu"),
  new RegExp(`${B}(?:add|use|put|show)\\s+(?:(?:the|an?)\\s+)?(?<cur>${CURRENCY})\\s+(?:signs?|symbols?)${E}`, "giu"),
  new RegExp(`${B}(?:s[ií]mbolo|signo|segno|sinal)\\s+(?:(?:de|del|do|da|dell['’]|della|dello)\\s*)?${ARTICLE}(?<cur>${CURRENCY})${E}`, "giu"),
];

// No verb at all: "In euro, not usd", "in euros please", "euros, not dollars",
// or just the currency.
const VERBLESS = [
  new RegExp(`^\\W*(?:in|en|em|nel|nella)\\s+${ARTICLE}(?<cur>${CURRENCY})${E}`, "iu"),
  new RegExp(
    `${B}(?<cur>${CURRENCY})\\s*,?\\s*(?:not|no|non|não|instead\\s+of|en\\s+vez\\s+de|en\\s+lugar\\s+de|invece\\s+(?:di|che)|em\\s+vez\\s+de)\\s+(?:(?:in|en|em)\\s+)?${ARTICLE}(?:${CURRENCY})${E}`,
    "iu"
  ),
  new RegExp(`^\\W*(?<cur>${CURRENCY})\\s*(?:please|pls|por\\s+favor|per\\s+favore|grazie|gracias|obrigad[oa]|thanks?)?\\W*$`, "iu"),
];

// Codes that are also words ("want to try"): these count only in capitals.
const CODES_THAT_ARE_WORDS = new Set(["TRY", "RON", "CAD", "PHP"]);

function toCode(token: string): string | null {
  const upper = token.toUpperCase();
  if (SUPPORTED_CURRENCIES.includes(upper) && (token === upper || !CODES_THAT_ARE_WORDS.has(upper))) return upper;
  for (const [code, words] of NAMES) {
    if (new RegExp(`^(?:${words})$`, "iu").test(token)) return code;
  }
  return null;
}

/** The currency the message asks prices to be shown in, or null. */
export function currencyRequested(message: string | null | undefined): string | null {
  const text = (message ?? "").trim();
  if (!text) return null;
  if (INTENT.test(text)) {
    for (const re of TARGETS) {
      for (const match of text.matchAll(re)) {
        const code = match.groups?.cur ? toCode(match.groups.cur.replace(/\s+/g, " ")) : null;
        if (code) return code;
      }
    }
  }
  for (const re of VERBLESS) {
    const cur = re.exec(text)?.groups?.cur;
    const code = cur ? toCode(cur.replace(/\s+/g, " ")) : null;
    if (code) return code;
  }
  return null;
}

const CURRENCY_TALK = new RegExp(`${B}(?:${CURRENCY}|currenc\\p{L}*|moneda|divisa|valuta|moeda)${E}`, "iu");

/**
 * The reply without its sentences about currency, which the switch now makes
 * true or false. With `keepPrices`, a sentence with figures stays: it prices
 * the change rather than talking about the currency.
 */
export function withoutCurrencyTalk(text: string | null | undefined, keepPrices = false): string {
  return (text ?? "")
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !CURRENCY_TALK.test(sentence) || (keepPrices && /\d/.test(sentence)))
    .join(" ")
    .trim();
}

type Lang = "en" | "es" | "it" | "pt";
const lang = (language: string | undefined): Lang => {
  const l = (language || "en").slice(0, 2).toLowerCase();
  return l === "es" || l === "it" || l === "pt" ? l : "en";
};

/** What the planner reads once the page shows prices in `code`. */
export function currencySwitchedNote(language: string | undefined, code: string): string {
  switch (lang(language)) {
    case "es":
      return `Hecho: ahora los precios se muestran en ${code}.`;
    case "it":
      return `Fatto: ora i prezzi sono mostrati in ${code}.`;
    case "pt":
      return `Pronto: agora os preços aparecem em ${code}.`;
    default:
      return `Done: prices now show in ${code}.`;
  }
}
