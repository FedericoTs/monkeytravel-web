/**
 * Keeps the trip assistant from telling someone it changed their itinerary
 * when nothing changed.
 *
 * WHY (2026-09-26)
 * One signed-in user planning a cruise got eight such replies in three days,
 * none with a change prepared or saved:
 *   "Your Day 5 is now dedicated to cruise embarkation from Civitavecchia."
 *   "Your Day 5 itinerary has been updated to include travel from Rome..."
 *   "Parea Tavern has been added for dinner on Day 7 in Santorini..."
 *   "I've added the train journey to your Day 1 itinerary. It's now scheduled..."
 * They wrote back "day 5 is still showing the Borghese Gallery", then
 * "everything is messed up", and deleted three hours of work. On the copy they
 * kept, a later reply had to concede "it hasn't been added".
 *
 * The prompt already forbids this (buildSystemPrompt: never state or imply a
 * change unless a NOTE says it was saved), and the model broke the rule anyway.
 * So the server checks the words: when nothing was saved and the reply claims
 * otherwise, it is replaced with one that says what is true.
 *
 * The check is deliberately narrow (a change verb in a completed or certain
 * form) so "I can add a boat tour", "would be updated" and "it hasn't been
 * added" all pass. A miss leaves the old behaviour; a false hit swaps a reply
 * for an honest one, which costs little.
 */

const L = "\\p{L}";
/** Word boundaries that also hold around accented letters (JS \b is ASCII-only). */
const start = `(?<![${L}'’])`;
const end = `(?![${L}])`;
const words = (list: string) => `(?:${list})`;

const EN_VERBS = words(
  "added|updated|removed|replaced|moved|changed|saved|scheduled|rescheduled|included|swapped|deleted|dedicated|adjusted|extended|shortened|reordered|put|set"
);

const CLAIM_PATTERNS: RegExp[] = [
  // English
  new RegExp(`${start}(?:has|have)\\s+been\\s+(?:now\\s+|also\\s+|successfully\\s+)?${EN_VERBS}${end}`, "iu"),
  new RegExp(`${start}(?:i|we)(?:['’]ve|\\s+have)\\s+(?:now\\s+|also\\s+|just\\s+|already\\s+|successfully\\s+)?${EN_VERBS}${end}`, "iu"),
  new RegExp(`${start}(?:i|we)\\s+(?:just\\s+|also\\s+|now\\s+)?(?:added|updated|removed|replaced|moved|changed|swapped|deleted|scheduled|rescheduled|put)${end}`, "iu"),
  new RegExp(`${start}(?:is|are|it['’]s|that['’]s)\\s+now\\s+(?:dedicated|scheduled|included|set|booked|planned|part\\s+of|on\\s+day|in\\s+your)${end}`, "iu"),
  new RegExp(`${start}(?:now|will\\s+now)\\s+(?:includes?|features?|contains?)${end}`, "iu"),
  // Spanish
  new RegExp(`${start}(?<!no\\s)(?:he|hemos)\\s+(?:ya\\s+)?${words("añadido|agregado|actualizado|eliminado|quitado|borrado|reemplazado|sustituido|cambiado|movido|incluido|programado|guardado|puesto|ajustado")}${end}`, "iu"),
  new RegExp(`${start}(?:ha|han)\\s+sido\\s+${words("añadid|agregad|actualizad|eliminad|quitad|borrad|reemplazad|sustituid|cambiad|movid|incluid|programad|guardad|ajustad")}[oa]s?${end}`, "iu"),
  new RegExp(`${start}(?<!no\\s)${words("añadí|agregué|actualicé|eliminé|quité|reemplacé|sustituí|cambié|moví|incluí|programé")}${end}`, "iu"),
  new RegExp(`${start}ahora\\s+(?:incluye|está\\s+dedicad[oa]|está\\s+programad[oa])${end}`, "iu"),
  // Italian
  new RegExp(`${start}(?<!non\\s)(?:ho|abbiamo)\\s+(?:già\\s+|anche\\s+|ora\\s+)?${words("aggiunto|aggiornato|rimosso|eliminato|tolto|sostituito|spostato|cambiato|inserito|incluso|programmato|salvato|modificato")}${end}`, "iu"),
  new RegExp(`${start}(?:è|sono)\\s+stat[oaie]\\s+${words("aggiunt|aggiornat|rimoss|eliminat|tolt|sostituit|spostat|cambiat|inserit|inclus|programmat|salvat|modificat")}[oaie]${end}`, "iu"),
  new RegExp(`${start}(?:ora|adesso)\\s+(?:include|comprende|è\\s+dedicat[oa])${end}`, "iu"),
  // Portuguese
  new RegExp(`${start}(?<!não\\s)${words("adicionei|acrescentei|atualizei|removi|retirei|substituí|troquei|mudei|movi|incluí|agendei|guardei|salvei|alterei")}${end}`, "iu"),
  new RegExp(`${start}(?:foi|foram)\\s+${words("adicionad|acrescentad|atualizad|removid|retirad|substituíd|trocad|mudad|movid|incluíd|agendad|guardad|salv|alterad")}[oa]s?${end}`, "iu"),
  new RegExp(`${start}agora\\s+(?:inclui|está\\s+dedicad[oa])${end}`, "iu"),
];

/** Does this reply say the itinerary was (or now is) changed? */
export function claimsItineraryChange(text: string | null | undefined): boolean {
  if (!text) return false;
  return CLAIM_PATTERNS.some((re) => re.test(text));
}

type Lang = "en" | "es" | "it" | "pt";
const lang = (language: string | undefined): Lang => {
  const l = (language || "en").slice(0, 2).toLowerCase();
  return l === "es" || l === "it" || l === "pt" ? l : "en";
};

/**
 * The reply when nothing was prepared or saved. It names the trip page's own
 * "Edit Trip" button (trips.detail.editTrip in each locale). Only English gets
 * a chat example, because the action parser only understands English commands.
 */
export function nothingChangedReply(language: string | undefined): string {
  switch (lang(language)) {
    case "es":
      return 'No he cambiado tu itinerario: no he podido hacer ese cambio desde aquí. Puedes hacerlo tú con "Editar Viaje".';
    case "it":
      return 'Non ho modificato il tuo itinerario: da qui non sono riuscito a fare questa modifica. Puoi farla tu con "Modifica Viaggio".';
    case "pt":
      return 'Não alterei o seu itinerário: não consegui fazer essa alteração daqui. Você pode fazê-la com "Editar Viagem".';
    default:
      return 'I haven\'t changed your itinerary: I couldn\'t make that change from here. You can make it with "Edit Trip", or ask me for one activity at a time, like "add a boat tour to day 5".';
  }
}

/** The reply when a change is prepared but waits for the Apply button. */
export function pendingChangeReply(language: string | undefined, buttonLabel: string): string {
  switch (lang(language)) {
    case "es":
      return `He preparado este cambio. No se guarda nada hasta que toques "${buttonLabel}" abajo.`;
    case "it":
      return `Ho preparato questa modifica. Non viene salvato nulla finché non tocchi "${buttonLabel}" qui sotto.`;
    case "pt":
      return `Preparei esta alteração. Nada é salvo até você tocar em "${buttonLabel}" abaixo.`;
    default:
      return `I've prepared this change. Nothing is saved until you tap "${buttonLabel}" below.`;
  }
}
