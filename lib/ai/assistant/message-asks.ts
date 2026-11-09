/**
 * What a traveller's message asks for or tells the assistant, where the rules a
 * reply is held to depend on it.
 */



// "Add 2 more days", "one more night", "extend the trip", "un día más",
// "2 giorni in più", "mais um dia", or a length in days. The wizard's date
// change asks with "set trip_length". A day of the trip is where a change
// goes, not more days: "add dinner on day 3", "l'ultimo giorno".
const L = "\\p{L}";
const THAT_DAY =
  "(?<!(?:first|last|next|same|second|third|final|each|every|that|this|primo|ultimo|secondo|terzo|stesso|ogni|quel|questo|primer|primero|último|segundo|tercer|tercero|mismo|cada|ese|este|primeiro|terceiro|mesmo|esse)\\s+)";
const MORE_DAYS = new RegExp(
  [
    "trip_length",
    `(?<![${L}])(?:add|adding|extra|more|another|extend|extending|longer|lengthen|más|otro|otra|añad\\p{L}*|agreg\\p{L}*|extend\\p{L}*|alarg\\p{L}*|più|altr[oi]|aggiung\\p{L}*|allung\\p{L}*|estend\\p{L}*|mais|outr[oa]s?|adicion\\p{L}*|acrescent\\p{L}*|prolong\\p{L}*)(?![${L}])[^.?!\\n]{0,24}?(?<![${L}])${THAT_DAY}(?:day|days|night|nights|día|días|noche|noches|giorno|giorni|notte|notti|dia|dias|noite|noites)(?![${L}])(?!\\s*\\d)`,
    `(?<![${L}])(?:giorn[oi]|nott[ei])\\s+in\\s+più`,
    `(?<![${L}\\p{N}])\\d{1,2}\\s*(?:days|nights|días|noches|giorni|notti|dias|noites)(?![${L}])`,
  ].join("|"),
  "iu",
);

// A day trip fits inside the trip: "add a day trip", "excursión de un día".
const DAY_TRIP =
  /day[\s-]?trips?|excursi[oó]n(?:es)? de un d[ií]a|gite? di un giorno|excurs(?:ão|ões) de um dia|bate[\s-]?volta/giu;

// A day by its number: "day 6", "giorno 6", "día 6", "dia 6".
const DAY_NUMBER = /(?<![\p{L}])(?:day|giorno|día|dia)\s+(\d{1,2})(?![\p{N}])/giu;

/**
 * Does the conversation ask for a longer trip? A day named by its number is
 * one of the trip's, unless the trip doesn't have it yet: "add day 6" to a
 * trip of `tripDays` 5.
 */
export function asksForMoreDays(text: string, tripDays?: number): boolean {
  const asked = text.replace(DAY_TRIP, " ");
  if (MORE_DAYS.test(asked)) return true;
  return tripDays !== undefined && [...asked.matchAll(DAY_NUMBER)].some((m) => Number(m[1]) > tripDays);
}

// A day with nothing planned: "leave day 2 free", "deixe o dia 2 livre".
const FREE_DAY =
  /(?<![\p{L}])(?:free|empty|clear|day\s+off|nothing\s+planned|libres?|vac[ií][oa]s?|liber[oiae]|vuot[oiae]|livres?|vazi[oa]s?|folga)(?![\p{L}])/iu;

/** Does the message ask for a day with nothing planned? */
export function asksForFreeDay(message: string): boolean {
  return FREE_DAY.test(message);
}

// Telling, not asking, where they stay: "our hotel is Hotel Arts", "we're
// staying at…", "nuestro hotel es…", "il nostro hotel è…", "vamos ficar no…".
const STAYING_AT =
  /(?:\b(?:our|my)\s+(?:hotel|airbnb|accommodation|hostel|stay)\s+(?:is|will be)\b|\b(?:we(?:'re| are)|i(?:'m| am))\s+staying\s+(?:at|in)\b|\bwe\s+booked\s+(?:a\s+|an\s+|the\s+)?(?:hotel|airbnb|room|apartment)\b|nuestro\s+(?:hotel|alojamiento)\s+es|nos\s+(?:alojamos|quedamos)\s+en|il\s+nostro\s+(?:hotel|albergo|alloggio)\s+è|alloggiamo\s+(?:a|al|in|presso)|o\s+nosso\s+(?:hotel|alojamento)\s+é|vamos\s+ficar\s+(?:no|na|em))/iu;
export const CHECK_IN = /check[\s-]?in|registro|registrazione|registrar/iu;
// "Our hotel is near the station": an area, not a place to check in at.
const NEAR = /^\s*(?:near|close|next|around|by|cerca|junto|al\s+lado|vicino|accanto|perto|ao\s+lado)\b/iu;

/** Does the message tell (not ask) the place they stay at? */
export function tellsWhereTheyStay(message: string): boolean {
  const m = STAYING_AT.exec(message);
  return !!m && !message.includes("?") && !NEAR.test(message.slice(m.index + m[0].length));
}
// A clock time: "23:00", "21h30", "3pm", "2 p.m.", "las 23 horas", "alle 14", "às 9h".
export const TELLS_TIME = /(?<![\p{L}\p{N}])(?:\d{1,2}[:.h]\d{2}|\d{1,2}\s*[ap]\.?m\.?(?![\p{L}])|(?:las|alle|às|as)\s+\d{1,2}(?![\p{N}]))/iu;

// Asking for something to be added: "add", "include", "agrega", "aggiungi"…
const ADD_ASK =
  /(?<![\p{L}])(?:add|adding|include|put|insert|fit|squeeze|agrega|agregar|añade|añadir|incluye|incluir|pon|aggiungi|aggiungere|inserisci|includi|metti|adiciona|adicionar|acrescenta|inclui|incluir|coloca)(?![\p{L}])/iu;

/** Does the traveller's message ask for something to be added? */
export function asksToAdd(message: string): boolean {
  return ADD_ASK.test(message);
}
