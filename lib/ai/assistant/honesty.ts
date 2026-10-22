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
  "added|updated|removed|replaced|moved|changed|saved|scheduled|rescheduled|included|swapped|deleted|dedicated|adjusted|extended|shortened|reordered|put|set|condensed|combined|merged|reworked|rearranged|reorganized|reorganised|restructured|revised|trimmed|incorporated|integrated|reverted|shifted|cleared"
);

// A promise is a claim too: "I'll update your accommodation to…" went out
// with no action behind it, and the traveller waited for a change that never
// came. So did "I'll create a new romantic Austin itinerary…". Verbs that also
// open an offer ("I'll put together", "I'll include a few tips") stay out.
const EN_PROMISE_VERBS = words(
  "update|add|adjust|change|move|remove|replace|schedule|reschedule|extend|shorten|swap|delete|rework|restructure|reorganize|reorganise|rearrange|incorporate|modify|shift|reconfigure|integrate|insert|reorder|create|build|generate|redo|rebuild|recreate|remake"
);
const ES_INFINITIVES = words(
  "actualizar|añadir|agregar|ajustar|cambiar|mover|eliminar|quitar|reemplazar|sustituir|programar|incorporar|modificar|acortar|extender|crear|generar"
);
const IT_INFINITIVES = words(
  "aggiornare|aggiungere|modificare|spostare|rimuovere|togliere|sostituire|programmare|inserire|cambiare|ridurre|estendere|prolungare|scambiare|creare|generare|rifare"
);
const IT_FUTURES = words(
  "aggiornerò|aggiungerò|modificherò|sposterò|rimuoverò|toglierò|sostituirò|programmerò|inserirò|cambierò|ridurrò|estenderò|prolungherò|scambierò|creerò|genererò|rifarò"
);
const PT_INFINITIVES = words(
  "atualizar|adicionar|acrescentar|ajustar|mudar|alterar|mover|remover|retirar|substituir|agendar|incluir|modificar|encurtar|prolongar|trocar|criar|gerar|refazer"
);
const PT_FUTURES = words(
  "atualizarei|adicionarei|acrescentarei|ajustarei|mudarei|alterarei|moverei|removerei|retirarei|substituirei|agendarei|incluirei|modificarei|encurtarei|prolongarei|trocarei|criarei|gerarei|refarei"
);

const CLAIM_PATTERNS: RegExp[] = [
  // English
  new RegExp(`${start}(?:has|have)\\s+been\\s+(?:now\\s+|also\\s+|successfully\\s+)?${EN_VERBS}${end}`, "iu"),
  new RegExp(`${start}(?:i|we)(?:['’]ve|\\s+have)\\s+(?:now\\s+|also\\s+|just\\s+|already\\s+|successfully\\s+)?${EN_VERBS}${end}`, "iu"),
  new RegExp(`${start}(?:i|we)\\s+(?:just\\s+|also\\s+|now\\s+)?(?:added|updated|removed|replaced|moved|changed|swapped|deleted|scheduled|rescheduled|put|condensed|combined|merged|reworked|rearranged|reorganized|reorganised|restructured|trimmed)${end}`, "iu"),
  new RegExp(`${start}(?:is|are|it['’]s|that['’]s)\\s+now\\s+(?:dedicated|scheduled|included|set|booked|planned|structured|organized|organised|arranged|aligned|adjusted|updated|optimized|optimised|reorganized|reorganised|rearranged|part\\s+of|on\\s+day|in\\s+your)${end}`, "iu"),
  new RegExp(`${start}(?:now|will\\s+now)\\s+(?:includes?|features?|contains?|reflects?)${end}`, "iu"),
  // "This update integrates Akihabara…", "Day 3, now with a sunset cruise".
  new RegExp(`${start}(?:this|the)\\s+(?:update|change|revision|new\\s+version|updated\\s+plan|revised\\s+plan)\\s+(?:now\\s+)?(?:integrates|incorporates|includes|adds|brings|puts)${end}`, "iu"),
  new RegExp(`${start}(?:day\\s+\\d+|your\\s+(?:trip|itinerary|plan|day)),?\\s+now\\s+with${end}`, "iu"),
  // A changed plan handed over as finished: "Here's an updated Day 1".
  new RegExp(`${start}here(?:['’]s|\\s+is|\\s+are)\\s+(?:an?\\s+|the\\s+|your\\s+)?(?:updated|revised|adjusted|modified|reworked)\\s+(?:\\d+-day\\s+)?(?:plan|itinerary|version|schedule|trip|days|day(?:\\s+\\d+)?)${end}`, "iu"),
  // Spanish
  new RegExp(`${start}(?<!no\\s)(?:he|hemos)\\s+(?:ya\\s+)?${words("añadido|agregado|actualizado|eliminado|quitado|borrado|reemplazado|sustituido|cambiado|movido|incluido|programado|guardado|puesto|ajustado|condensado|combinado|fusionado|reorganizado|reestructurado|reducido|acortado|incorporado|integrado|modificado|unificado|intercambiado|revertido")}${end}`, "iu"),
  new RegExp(`${start}(?:ha|han)\\s+sido\\s+${words("añadid|agregad|actualizad|eliminad|quitad|borrad|reemplazad|sustituid|cambiad|movid|incluid|programad|guardad|ajustad|condensad|combinad|fusionad|reorganizad|reestructurad|reducid|acortad|incorporad|integrad|modificad|unificad|intercambiad|revertid")}[oa]s?${end}`, "iu"),
  new RegExp(`${start}(?<!no\\s)${words("añadí|agregué|actualicé|eliminé|quité|reemplacé|sustituí|cambié|moví|incluí|programé|condensé|combiné|fusioné|reorganicé|reestructuré|acorté|incorporé|integré|modifiqué|unifiqué|intercambié")}${end}`, "iu"),
  new RegExp(`${start}ahora\\s+(?:incluye|está\\s+(?:dedicad|programad|organizad|estructurad|ajustad|alinead|actualizad)[oa])${end}`, "iu"),
  new RegExp(`${start}aquí\\s+(?:tienes|está|están)\\s+(?:el|la|los|las|tu|tus|un|una)\\s+(?:plan|itinerario|versión|días?(?:\\s+\\d+)?)\\s+(?:actualizad|revisad|modificad|ajustad)[oa]s?${end}`, "iu"),
  // Italian
  new RegExp(`${start}(?<!non\\s)(?:ho|abbiamo)\\s+(?:già\\s+|anche\\s+|ora\\s+)?${words("aggiunto|aggiornato|rimosso|eliminato|tolto|sostituito|spostato|cambiato|inserito|incluso|programmato|salvato|modificato|condensato|combinato|unito|riorganizzato|ristrutturato|ridotto|accorciato|scambiato|incorporato|integrato|unificato|ripristinato")}${end}`, "iu"),
  new RegExp(`${start}(?:è|sono)\\s+stat[oaie]\\s+${words("aggiunt|aggiornat|rimoss|eliminat|tolt|sostituit|spostat|cambiat|inserit|inclus|programmat|salvat|modificat|condensat|combinat|unit|riorganizzat|ristrutturat|ridott|accorciat|scambiat|incorporat|integrat|unificat|ripristinat")}[oaie]${end}`, "iu"),
  new RegExp(`${start}(?:ora|adesso)\\s+(?:include|comprende|è\\s+(?:dedicat|organizzat|strutturat|allineat|aggiornat)[oa])${end}`, "iu"),
  new RegExp(`${start}ecco\\s+(?:(?:il|la|i|le|un|una|il\\s+tuo|la\\s+tua|i\\s+tuoi)\\s+|l['’])(?:piano|itinerario|versione|giorn[oi](?:\\s+\\d+)?)\\s+(?:aggiornat|rivist|modificat)[oaie]${end}`, "iu"),
  // Portuguese
  new RegExp(`${start}(?<!não\\s)${words("adicionei|acrescentei|atualizei|removi|retirei|substituí|troquei|mudei|movi|incluí|agendei|guardei|salvei|alterei|condensei|combinei|juntei|reorganizei|reestruturei|reduzi|encurtei|incorporei|integrei|unifiquei|reverti")}${end}`, "iu"),
  new RegExp(`${start}(?:foi|foram)\\s+${words("adicionad|acrescentad|atualizad|removid|retirad|substituíd|trocad|mudad|movid|incluíd|agendad|guardad|salv|alterad|condensad|combinad|juntad|reorganizad|reestruturad|reduzid|encurtad|incorporad|integrad|unificad|revertid")}[oa]s?${end}`, "iu"),
  new RegExp(`${start}agora\\s+(?:inclui|está\\s+(?:dedicad|organizad|estruturad|alinhad|ajustad|atualizad)[oa])${end}`, "iu"),
  new RegExp(`${start}aqui\\s+(?:está|estão)\\s+(?:o|a|os|as|seu|sua|seus|suas|o\\s+seu|a\\s+sua)\\s+(?:plano|itinerário|versão|dias?(?:\\s+\\d+)?)\\s+(?:atualizad|revisad|modificad|ajustad)[oa]s?${end}`, "iu"),
  // Promises (see EN_PROMISE_VERBS above)
  new RegExp(`${start}(?:i(?:['’]ll|\\s+will)|let\\s+me|i(?:['’]m|\\s+am)\\s+(?:going|preparing|about)\\s+to)\\s+(?:now\\s+|just\\s+|also\\s+|go\\s+ahead\\s+and\\s+)?${EN_PROMISE_VERBS}${end}`, "iu"),
  new RegExp(`${start}(?<!no\\s)(?:voy\\s+a\\s+(?:lo\\s+|la\\s+|los\\s+|las\\s+)?${ES_INFINITIVES}|${ES_INFINITIVES}é)${end}`, "iu"),
  new RegExp(`${start}(?<!non\\s)(?:${IT_FUTURES}|sto\\s+per\\s+${IT_INFINITIVES})${end}`, "iu"),
  new RegExp(`${start}(?<!não\\s)(?:vou\\s+${PT_INFINITIVES}|${PT_FUTURES})${end}`, "iu"),
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
 * Opens a wizard reply that talks as if a prepared edit were already done
 * ("I've updated Day 2"). Read first, so the Apply button isn't skipped; the
 * label is the wizard's button (trips.assistant.apply in each locale).
 */
export function notAppliedLead(language: string | undefined): string {
  switch (lang(language)) {
    case "es":
      return 'Aún no aplicado: toca "Aplicar cambio" abajo para actualizar tu plan.';
    case "it":
      return 'Non ancora applicato: tocca "Applica modifica" qui sotto per aggiornare il tuo piano.';
    case "pt":
      return 'Ainda não aplicado: toque em "Aplicar alteração" abaixo para atualizar o seu plano.';
    default:
      return 'Not applied yet: tap "Apply change" below to update your plan.';
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

// "Noted" and "recorded" tell the traveller that their hotel or flight is
// kept somewhere. The trip assistant keeps nothing but the last few messages.
const REMEMBER_PATTERNS: RegExp[] = [
  new RegExp(`${start}(?:has|have)\\s+been\\s+(?:noted|recorded|logged|registered)${end}`, "iu"),
  new RegExp(`${start}(?:i|we)(?:['’]ve|\\s+have)\\s+(?:noted|recorded|made\\s+a\\s+note|taken\\s+note)${end}`, "iu"),
  new RegExp(`${start}(?:i|we)(?:['’]ll|\\s+will)\\s+(?:keep|bear)\\s+(?:that|this|it|these|those)\\s+in\\s+mind${end}`, "iu"),
  new RegExp(`${start}(?:is|are)\\s+(?:now\\s+)?(?:noted|recorded|on\\s+file)${end}`, "iu"),
  new RegExp(`^\\s*(?:noted|anotado|annotato)[!.,]`, "iu"),
  new RegExp(`${start}(?:he|hemos)\\s+tomado\\s+nota${end}`, "iu"),
  new RegExp(`${start}(?:queda|quedan|ha\\s+sido|han\\s+sido)\\s+(?:anotad|registrad)[oa]s?${end}`, "iu"),
  new RegExp(`${start}lo\\s+tendré\\s+en\\s+cuenta${end}`, "iu"),
  new RegExp(`${start}(?:ho|abbiamo)\\s+preso\\s+nota${end}`, "iu"),
  new RegExp(`${start}(?:è|sono)\\s+stat[oaie]\\s+(?:annotat|registrat)[oaie]${end}`, "iu"),
  new RegExp(`${start}(?:lo|ne)\\s+terrò\\s+(?:presente|a\\s+mente|conto)${end}`, "iu"),
  new RegExp(`${start}(?:tomei|tomamos)\\s+nota${end}`, "iu"),
  new RegExp(`${start}anotei${end}`, "iu"),
  new RegExp(`${start}(?:foi|foram)\\s+(?:anotad|registrad)[oa]s?${end}`, "iu"),
  new RegExp(`${start}(?:vou\\s+ter|terei)\\s+(?:isso|isto)\\s+em\\s+(?:conta|mente)${end}`, "iu"),
];

/** Does this reply tell the traveller that what they said is kept somewhere? */
export function claimsToRemember(text: string | null | undefined): boolean {
  if (!text) return false;
  return REMEMBER_PATTERNS.some((re) => re.test(text));
}

/**
 * The trip assistant's reply when it implied it kept a detail it cannot keep
 * (a hotel, a flight time). Same "Edit Trip" button as nothingChangedReply;
 * only English gets a chat example, for the same reason.
 */
export function nothingKeptReply(language: string | undefined): string {
  switch (lang(language)) {
    case "es":
      return 'Desde aquí no puedo guardar datos como hoteles u horarios de vuelo, y solo recuerdo los últimos mensajes. Puedes ponerlos en el plan con "Editar Viaje".';
    case "it":
      return 'Da qui non posso conservare dati come hotel od orari dei voli, e ricordo solo gli ultimi messaggi. Puoi inserirli nel piano con "Modifica Viaggio".';
    case "pt":
      return 'Daqui não consigo guardar dados como hotéis ou horários de voo, e só me lembro das últimas mensagens. Você pode colocá-los no plano com "Editar Viagem".';
    default:
      return 'I can\'t keep details like hotels or flight times from here, and I only remember the last few messages. Put them in the plan with "Edit Trip", or ask me for one activity at a time, like "add hotel check-in to day 1".';
  }
}

// An answer that announces figures or a list, then stops: "Ecco un calcolo
// del costo totale stimato per il tuo viaggio." went out three times in a row
// (2026-10-21) with no number in any of them.
const ANNOUNCE_LEAD = words(
  "here(?:['’]s|\\s+is|\\s+are)|below\\s+(?:is|are)|ecco|di\\s+seguito|qui\\s+sotto|aquí\\s+(?:tienes|está|están|va|te\\s+dejo)|a\\s+continuación|aqui\\s+(?:está|estão|vai|vão)|segue(?:m)?|abaixo\\s+(?:está|estão)"
);
const ANNOUNCE_NOUN = words(
  "calculation|breakdown|estimate|total|summary|list|overview|rundown|budget|calcolo|riepilogo|totale|elenco|lista|stima|preventivo|dettaglio|cálculo|calculo|desglose|resumen|estimación|estimacion|presupuesto|detalle|resumo|estimativa|orçamento|orcamento|detalhamento"
);
const ANNOUNCEMENT = new RegExp(`${start}${ANNOUNCE_LEAD}\\s+(?:[${L}'’-]+\\s+){0,4}?${ANNOUNCE_NOUN}${end}`, "iu");
const COST_WORD = new RegExp(
  `${start}${words("cost|costs|total|budget|price|prices|spend|calculation|costo|costi|totale|spesa|prezzi|calcolo|preventivo|coste|costes|precio|precios|gasto|cálculo|calculo|presupuesto|custo|custos|preço|preços|orçamento|orcamento")}${end}`,
  "iu"
);
// Figures count as an answer; a lone digit ("day 3", "9 giorni") does not.
const FIGURE = /\d{2,}|[€$£¥]\s?\d/;

/**
 * Does this reply announce an answer it doesn't give? "cost" when what it
 * announced was a figure (a total, a budget), "other" for a list or summary.
 */
export function announcedButMissing(text: string | null | undefined): "cost" | "other" | null {
  const t = (text ?? "").trim();
  if (!t || FIGURE.test(t)) return null;
  const sentences = t.split(/(?<=[.!?…])\s+/).filter(Boolean);
  const last = sentences[sentences.length - 1] ?? "";
  // A colon that ends the reply introduced something that never came.
  const dangling = /:\s*$/.test(t);
  if (!dangling && (/:\s*\S/.test(last) || !ANNOUNCEMENT.test(last))) return null;
  return COST_WORD.test(dangling ? t : last) ? "cost" : "other";
}

/**
 * Stands in for an announced total that never came: what the plan's
 * activities add up to, in the currency the traveller sees.
 */
export function planCostsReply(
  language: string | undefined,
  costs: { currency: string; total: number; shown?: { currency: string; total: number } }
): string {
  const l = lang(language);
  const shown = costs.shown ?? costs;
  const amount = `${new Intl.NumberFormat(l).format(shown.total)} ${shown.currency}`;
  switch (l) {
    case "es":
      return `Las actividades de tu plan suman unos ${amount}. Los hoteles y los vuelos no están en el plan, así que súmalos aparte.`;
    case "it":
      return `Le attività del tuo piano costano in tutto circa ${amount}. Hotel e voli non sono nel piano, quindi aggiungili a parte.`;
    case "pt":
      return `As atividades do seu plano somam cerca de ${amount}. Hotéis e voos não estão no plano, então some-os à parte.`;
    default:
      return `The activities in your plan come to about ${amount}. Hotels and flights aren't in the plan, so add those on top.`;
  }
}

/** Stands in for an announced list or summary that never came. */
export function missingAnswerReply(language: string | undefined): string {
  switch (lang(language)) {
    case "es":
      return "No he podido preparar esa respuesta. Pregúntame una cosa a la vez, por ejemplo qué hacer el día 2.";
    case "it":
      return "Non sono riuscito a preparare questa risposta. Chiedimi una cosa alla volta, per esempio cosa fare il giorno 2.";
    case "pt":
      return "Não consegui preparar essa resposta. Pergunte uma coisa de cada vez, por exemplo o que fazer no dia 2.";
    default:
      return "I couldn't put that answer together. Ask me one thing at a time, like what to do on day 2.";
  }
}
