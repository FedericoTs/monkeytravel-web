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

// Restructuring verbs (condensed, rearranged…) since the wizard assistant can
// reshape whole trips: "I've condensed your Rome trip into 3 days" (2026-09-26).
// Not "reviewed"/"revisado"/"rivisto"/"revisei": those also mean "checked".
const EN_VERBS = words(
  "added|updated|removed|replaced|moved|changed|saved|scheduled|rescheduled|included|swapped|deleted|dedicated|adjusted|extended|shortened|reordered|put|set|condensed|combined|merged|reworked|rearranged|reorganized|reorganised|restructured|revised|trimmed"
);

const CLAIM_PATTERNS: RegExp[] = [
  // English
  new RegExp(`${start}(?:has|have)\\s+been\\s+(?:now\\s+|also\\s+|successfully\\s+)?${EN_VERBS}${end}`, "iu"),
  new RegExp(`${start}(?:i|we)(?:['’]ve|\\s+have)\\s+(?:now\\s+|also\\s+|just\\s+|already\\s+|successfully\\s+)?${EN_VERBS}${end}`, "iu"),
  new RegExp(`${start}(?:i|we)\\s+(?:just\\s+|also\\s+|now\\s+)?(?:added|updated|removed|replaced|moved|changed|swapped|deleted|scheduled|rescheduled|put|condensed|combined|merged|reworked|rearranged|reorganized|reorganised|restructured|trimmed)${end}`, "iu"),
  new RegExp(`${start}(?:is|are|it['’]s|that['’]s)\\s+now\\s+(?:dedicated|scheduled|included|set|booked|planned|part\\s+of|on\\s+day|in\\s+your)${end}`, "iu"),
  new RegExp(`${start}(?:now|will\\s+now)\\s+(?:includes?|features?|contains?)${end}`, "iu"),
  // Spanish
  new RegExp(`${start}(?<!no\\s)(?:he|hemos)\\s+(?:ya\\s+)?${words("añadido|agregado|actualizado|eliminado|quitado|borrado|reemplazado|sustituido|cambiado|movido|incluido|programado|guardado|puesto|ajustado|condensado|combinado|fusionado|reorganizado|reestructurado|reducido|acortado")}${end}`, "iu"),
  new RegExp(`${start}(?:ha|han)\\s+sido\\s+${words("añadid|agregad|actualizad|eliminad|quitad|borrad|reemplazad|sustituid|cambiad|movid|incluid|programad|guardad|ajustad|condensad|combinad|fusionad|reorganizad|reestructurad|reducid|acortad")}[oa]s?${end}`, "iu"),
  new RegExp(`${start}(?<!no\\s)${words("añadí|agregué|actualicé|eliminé|quité|reemplacé|sustituí|cambié|moví|incluí|programé|condensé|combiné|fusioné|reorganicé|reestructuré|acorté")}${end}`, "iu"),
  new RegExp(`${start}ahora\\s+(?:incluye|está\\s+dedicad[oa]|está\\s+programad[oa])${end}`, "iu"),
  // Italian
  new RegExp(`${start}(?<!non\\s)(?:ho|abbiamo)\\s+(?:già\\s+|anche\\s+|ora\\s+)?${words("aggiunto|aggiornato|rimosso|eliminato|tolto|sostituito|spostato|cambiato|inserito|incluso|programmato|salvato|modificato|condensato|combinato|unito|riorganizzato|ristrutturato|ridotto|accorciato|scambiato")}${end}`, "iu"),
  new RegExp(`${start}(?:è|sono)\\s+stat[oaie]\\s+${words("aggiunt|aggiornat|rimoss|eliminat|tolt|sostituit|spostat|cambiat|inserit|inclus|programmat|salvat|modificat|condensat|combinat|unit|riorganizzat|ristrutturat|ridott|accorciat|scambiat")}[oaie]${end}`, "iu"),
  new RegExp(`${start}(?:ora|adesso)\\s+(?:include|comprende|è\\s+dedicat[oa])${end}`, "iu"),
  // Portuguese
  new RegExp(`${start}(?<!não\\s)${words("adicionei|acrescentei|atualizei|removi|retirei|substituí|troquei|mudei|movi|incluí|agendei|guardei|salvei|alterei|condensei|combinei|juntei|reorganizei|reestruturei|reduzi|encurtei")}${end}`, "iu"),
  new RegExp(`${start}(?:foi|foram)\\s+${words("adicionad|acrescentad|atualizad|removid|retirad|substituíd|trocad|mudad|movid|incluíd|agendad|guardad|salv|alterad|condensad|combinad|juntad|reorganizad|reestruturad|reduzid|encurtad")}[oa]s?${end}`, "iu"),
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

/**
 * The wizard assistant's reply when it prepared nothing but claimed a change.
 * The wizard has no "Edit Trip" button; its assistant understands every
 * language, so the example is the traveller's own.
 */
export function wizardNothingChangedReply(language: string | undefined): string {
  switch (lang(language)) {
    case "es":
      return 'No he cambiado tu plan: no he podido hacer ese cambio. Prueba a pedírmelo día por día, por ejemplo "haz que el día 3 sea de avistamiento de ballenas".';
    case "it":
      return 'Non ho modificato il tuo piano: non sono riuscito a fare questa modifica. Prova a chiedermela giorno per giorno, per esempio "fai del giorno 3 una giornata di whale watching".';
    case "pt":
      return 'Não alterei o seu plano: não consegui fazer essa alteração. Tente pedir dia a dia, por exemplo "faça do dia 3 um dia de observação de baleias".';
    default:
      return 'I haven\'t changed your plan: I couldn\'t make that change. Try asking for it day by day, like "make day 3 about whale watching".';
  }
}

/**
 * Appended when the reply talks about days its edit does not include, e.g. a
 * "swap" that only prepared one side of it.
 */
export function uncoveredDaysNote(language: string | undefined, covered: number[], uncovered: number[]): string {
  const list = (ns: number[]) => ns.join(", ");
  switch (lang(language)) {
    case "es":
      return `(Este cambio incluye solo el día ${list(covered)}. Pídeme el día ${list(uncovered)} si también quieres cambiarlo.)`;
    case "it":
      return `(Questa modifica riguarda solo il giorno ${list(covered)}. Chiedimi il giorno ${list(uncovered)} se vuoi cambiare anche quello.)`;
    case "pt":
      return `(Esta alteração inclui só o dia ${list(covered)}. Peça-me o dia ${list(uncovered)} se também o quiser alterar.)`;
    default:
      return `(This change covers Day ${list(covered)} only. Ask me for Day ${list(uncovered)} if you want that changed too.)`;
  }
}

/**
 * Appended when the wizard assistant prepared an edit but its reply talks as
 * if it were already done ("Ho aggiunto un sesto giorno"). It is not done until
 * the traveller taps Apply; the label is the wizard's button
 * (trips.assistant.apply in each locale).
 */
export function applyToSaveNote(language: string | undefined): string {
  switch (lang(language)) {
    case "es":
      return '(No cambia nada hasta que toques "Aplicar cambio" abajo.)';
    case "it":
      return '(Non cambia nulla finché non tocchi "Applica modifica" qui sotto.)';
    case "pt":
      return '(Nada muda até você tocar em "Aplicar alteração" abaixo.)';
    default:
      return '(Nothing changes until you tap "Apply change" below.)';
  }
}

/** The wizard assistant's reply when the only day it could change is fixed. */
export function lockedDayReply(language: string | undefined, dayNumber: number, names: string[]): string {
  const fixed = names.join(", ");
  switch (lang(language)) {
    case "es":
      return `El día ${dayNumber} gira en torno a un plan fijo (${fixed}), así que lo he dejado como estaba. Puedo rehacer los otros días.`;
    case "it":
      return `Il giorno ${dayNumber} è costruito attorno a un impegno fisso (${fixed}), quindi l'ho lasciato com'è. Posso rifare gli altri giorni.`;
    case "pt":
      return `O dia ${dayNumber} é organizado em torno de um compromisso fixo (${fixed}), então deixei como está. Posso refazer os outros dias.`;
    default:
      return `Day ${dayNumber} is built around a fixed plan (${fixed}), so I left it as it is. I can rework the other days instead.`;
  }
}

/** The wizard assistant's fallbacks when the model returned no reply text. */
export function wizardFallbackReply(language: string | undefined, prepared: boolean): string {
  switch (lang(language)) {
    case "es":
      return prepared ? "Aquí tienes el cambio." : "Aquí estoy para ayudarte: pregúntame lo que quieras sobre tu viaje.";
    case "it":
      return prepared ? "Ecco la modifica." : "Sono qui per aiutarti: chiedimi qualsiasi cosa sul tuo viaggio.";
    case "pt":
      return prepared ? "Aqui está a alteração." : "Estou aqui para ajudar: pergunte o que quiser sobre a sua viagem.";
    default:
      return prepared ? "Here's the change." : "Here to help — ask me anything about your trip.";
  }
}

/** Appended when the reply meant to change the trip's length but couldn't. */
export function lengthUnchangedNote(language: string | undefined, days: number): string {
  switch (lang(language)) {
    case "es":
      return `(El viaje sigue teniendo ${days} días: no he podido preparar los días nuevos. Pídemelo otra vez, un día cada vez.)`;
    case "it":
      return `(Il viaggio resta di ${days} giorni: non sono riuscito a preparare i giorni nuovi. Chiedimelo di nuovo, un giorno alla volta.)`;
    case "pt":
      return `(A viagem continua com ${days} dias: não consegui preparar os dias novos. Peça de novo, um dia de cada vez.)`;
    default:
      return `(The trip stays at ${days} days: I couldn't prepare the new days. Ask me again, one day at a time.)`;
  }
}
