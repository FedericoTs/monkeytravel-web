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
  "added|updated|removed|replaced|moved|changed|saved|scheduled|rescheduled|included|swapped|deleted|dedicated|adjusted|extended|shortened|reordered|put|set|condensed|combined|merged|reworked|rearranged|reorganized|reorganised|restructured|revised|trimmed|incorporated|integrated|reverted|shifted|cleared|freed"
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
  // A day said to be free now: "Day 3 is now free", "o dia 2 está agora livre".
  new RegExp(`${start}(?:is|are|it['’]s|they['’]re|that['’]s)\\s+now\\s+(?:free|clear|empty)${end}`, "iu"),
  new RegExp(`${start}(?:(?:está|están)\\s+ahora\\s+libres?|ahora\\s+(?:está|están|quedan?)\\s+libres?|(?:quedó|quedaron|ha\\s+quedado|han\\s+quedado)\\s+libres?)${end}`, "iu"),
  new RegExp(`${start}(?:(?:è|sono)\\s+ora\\s+liber[oiae]|ora\\s+(?:è|sono)\\s+liber[oiae]|(?:è|sono)\\s+stat[oaie]\\s+liberat[oaie])${end}`, "iu"),
  new RegExp(`${start}(?:(?:está|estão)\\s+agora\\s+livres?|agora\\s+(?:está|estão|fica|ficam)\\s+livres?|(?:ficou|ficaram)\\s+livres?)${end}`, "iu"),
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

// Handing over a proposal: "Ecco la proposta per rimuovere…", "Here is the
// proposed addition:", "I'll propose adding a Beer Spa…". True only with the
// change attached, so it is read only when nothing was prepared (unlike
// claimsItineraryChange, which also runs on a prepared change).
const PROPOSAL_PATTERNS: RegExp[] = [
  new RegExp(`${start}here(?:['’]s|\\s+is)\\s+(?:the|a|my)\\s+(?:proposal|proposed|suggested\\s+change)${end}`, "iu"),
  new RegExp(`${start}i(?:['’]ll|\\s+will|['’]m\\s+going\\s+to|\\s+am\\s+going\\s+to)?\\s+(?:now\\s+|also\\s+)?propose${end}`, "iu"),
  new RegExp(`${start}i(?:['’]m|\\s+am)\\s+proposing${end}`, "iu"),
  new RegExp(`${start}ecco\\s+(?:la\\s+mia|la|una)\\s+(?:proposta|modifica)${end}`, "iu"),
  new RegExp(`${start}(?:ti|vi)\\s+propongo\\s+(?:la|una|questa)\\s+(?:seguente\\s+)?(?:proposta|modifica)${end}`, "iu"),
  new RegExp(`${start}(?<!non\\s)(?:ti\\s+|vi\\s+)?proporrò${end}`, "iu"),
  new RegExp(`${start}aquí\\s+(?:tienes|está|va)\\s+(?:mi|la|una)\\s+propuesta${end}`, "iu"),
  new RegExp(`${start}te\\s+propongo\\s+(?:el|este|un|el\\s+siguiente)\\s+cambio${end}`, "iu"),
  new RegExp(`${start}(?<!no\\s)(?:te\\s+)?propondré${end}`, "iu"),
  new RegExp(`${start}aqui\\s+(?:está|vai)\\s+(?:a\\s+minha|a|uma|minha)\\s+proposta${end}`, "iu"),
  new RegExp(`${start}(?:te\\s+)?proponho\\s+(?:a\\s+seguinte|a|esta|uma)\\s+(?:alteração|mudança)${end}`, "iu"),
  new RegExp(`${start}(?<!não\\s)(?:vou\\s+(?:te\\s+)?propor|proporei)${end}`, "iu"),
];

/** Does this reply say it comes with a proposed change? */
export function announcesProposal(text: string | null | undefined): boolean {
  if (!text) return false;
  return PROPOSAL_PATTERNS.some((re) => re.test(text));
}

// Offering a change: "posso rimuovere la cena…", "I can add nightclubs on
// nights 2, 4 and 6", "vuoi che aggiunga…?".
const OFFER_PATTERNS: RegExp[] = [
  new RegExp(`${start}i\\s+(?:can|could)\\s+(?:also\\s+|certainly\\s+)?(?:add|remove|replace|swap|move|include|put|schedule|take\\s+out|drop|switch|insert|fit|slot|propose)${end}`, "iu"),
  new RegExp(`${start}(?:would\\s+you\\s+like|do\\s+you\\s+want|want)\\s+me\\s+to\\s+(?:add|remove|replace|swap|move|include|put|schedule|take|drop|switch|insert|fit|suggest|find)${end}`, "iu"),
  new RegExp(`${start}(?:shall|should)\\s+i\\s+(?:add|remove|replace|swap|move|include|put|schedule|take|drop|switch|insert|fit)${end}`, "iu"),
  new RegExp(`${start}(?<!non\\s)(?:posso|potrei|potremmo)\\s+(?:anche\\s+)?(?:aggiung|rimuov|togl|elimin|sostitu|spost|inser|includ|mett)\\p{L}*`, "iu"),
  new RegExp(`${start}(?:(?:ti|vi|te)\\s+)?propongo${end}`, "iu"),
  new RegExp(`${start}vuoi\\s+che\\s+(?:ti\\s+|lo\\s+|la\\s+|li\\s+|le\\s+)?(?:aggiung|rimuov|tolg|elimin|sostitu|spost|inser|includ|mett|suggerisc|propong)\\p{L}*`, "iu"),
  new RegExp(`${start}(?<!no\\s)(?:puedo|podría|podríamos)\\s+(?:también\\s+)?(?:añad|agreg|quit|elimin|sustitu|reemplaz|mov|inclu|pon)\\p{L}*`, "iu"),
  new RegExp(`${start}quieres\\s+que\\s+(?:te\\s+|lo\\s+|la\\s+|los\\s+|las\\s+)?(?:añad|agregu|quit|elimin|sustituy|reemplac|muev|incluy|pong|sugier|propong)\\p{L}*`, "iu"),
  new RegExp(`${start}(?<!não\\s)(?:posso|poderia|poderíamos)\\s+(?:também\\s+)?(?:adicion|acrescent|remov|tir|troc|substitu|mov|inclu|coloc)\\p{L}*`, "iu"),
  new RegExp(`${start}proponho${end}`, "iu"),
  new RegExp(`${start}quer\\s+que\\s+eu\\s+(?:adicion|acrescent|remov|tir|troqu|substitu|mov|inclu|coloqu|sugir|propon)\\p{L}*`, "iu"),
];

/** Does this reply offer to change the plan? */
export function offersChange(text: string | null | undefined): boolean {
  if (!text) return false;
  return OFFER_PATTERNS.some((re) => re.test(text));
}

// A short yes, maybe with a word or two more: "ok", "sì aggiungi", "dale".
const YES = new RegExp(
  `^${words(
    "yes|yeah|yep|yup|ok|okay|okey|k|sure|alright|fine|great|perfect|agreed|confirm|confirmed|go\\s+ahead|do\\s+it|do\\s+that|please\\s+do|sounds\\s+good|si|sì|sí|vale|dale|claro|perfecto|genial|venga|de\\s+acuerdo|hazlo|adelante|certo|perfetto|ottimo|va\\s+bene|d['’]accordo|procedi|fallo|confermo|esatto|sim|perfeito|ótimo|otimo|beleza|pode\\s+ser|combinado|isso|tudo\\s+bem|faz\\s+isso|faça\\s+isso"
  )}${end}`,
  "iu"
);

/** Is the message a short yes, the answer to an offer? */
export function isConfirmation(message: string | null | undefined): boolean {
  const t = (message ?? "").trim().replace(/^[^\p{L}]+/u, "");
  if (!t || t.includes("?")) return false;
  return t.split(/[^\p{L}\p{N}'’]+/u).filter(Boolean).length <= 4 && YES.test(t);
}

type Lang = "en" | "es" | "it" | "pt";
const lang = (language: string | undefined): Lang => {
  const l = (language || "en").slice(0, 2).toLowerCase();
  return l === "es" || l === "it" || l === "pt" ? l : "en";
};

// Short words each language uses all the time and the others rarely do.
const COMMON_WORDS: Record<Lang, Set<string>> = {
  en: new Set("the and your you with this here have has is are to of for on at day days added from will can".split(" ")),
  es: new Set("el los las del y para con tu tus aquí día días más muy he está son es por una un al como también hay".split(" ")),
  it: new Set("il gli della delle dei che ho ecco più molto per giorno giorni è sono una un tuo tua ai anche alla nel con".split(" ")),
  pt: new Set("os do da dos das em com você seu sua aqui mais muito é são dia dias não ao uma um também na para".split(" ")),
};

/**
 * The language a reply is written in, or undefined when unsure. The model
 * answers in the traveller's language, which can differ from the plan's.
 */
export function replyLanguage(text: string): Lang | undefined {
  const words = text.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean);
  const scores = (Object.keys(COMMON_WORDS) as Lang[])
    .map((l) => ({ l, n: words.filter((w) => COMMON_WORDS[l].has(w)).length }))
    .sort((a, b) => b.n - a.n);
  return scores[0].n >= 2 && scores[0].n >= 1.5 * scores[1].n ? scores[0].l : undefined;
}

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

/**
 * Appended when an answer handed over a change that could not be attached. The
 * concierge streams its words before it knows whether the change came with them.
 */
export function noProposalNote(language: string | undefined): string {
  switch (lang(language)) {
    case "es":
      return "(Este cambio no está listo: no hay nada que confirmar. Pídemelo de nuevo con el día y la actividad.)";
    case "it":
      return "(Questa modifica non è pronta: non c'è niente da confermare. Chiedimela di nuovo indicando giorno e attività.)";
    case "pt":
      return "(Esta alteração não está pronta: não há nada para confirmar. Peça de novo com o dia e a atividade.)";
    default:
      return "(That change isn't ready: there's nothing to confirm. Ask me again with the day and the activity.)";
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

/** Does the text give figures (a price, a time), not just a day number? */
export function hasFigures(text: string | null | undefined): boolean {
  return FIGURE.test(text ?? "");
}

/**
 * Does this reply announce an answer it doesn't give? "cost" when what it
 * announced was a figure (a total, a budget), "other" for a list or summary.
 * A colon that ends the reply introduced something that never came, even
 * after figures ("…the 22nd. Here are the updates:").
 */
export function announcedButMissing(text: string | null | undefined): "cost" | "other" | null {
  const t = (text ?? "").trim();
  const dangling = /:\s*$/.test(t);
  if (!t || (!dangling && FIGURE.test(t))) return null;
  const sentences = t.split(/(?<=[.!?…])\s+/).filter(Boolean);
  const last = sentences[sentences.length - 1] ?? "";
  if (!dangling && (/:\s*\S/.test(last) || !ANNOUNCEMENT.test(last))) return null;
  return COST_WORD.test(dangling && !FIGURE.test(t) ? t : last) ? "cost" : "other";
}

/** The reply without a last sentence that ends on a colon with nothing after it. */
export function withoutDanglingLead(text: string): string {
  const t = text.trim();
  if (!/:\s*$/.test(t)) return t;
  return t.split(/(?<=[.!?…])\s+/).filter(Boolean).slice(0, -1).join(" ").trim();
}

// Saying the trip got longer: "I've added two extra days", "esto extiende el viaje".
const LONGER_TRIP: RegExp[] = [
  new RegExp(`${start}(?:extend(?:s|ed)?|lengthen(?:s|ed)?)\\s+(?:your|the)\\s+(?:trip|itinerary|stay)${end}`, "iu"),
  new RegExp(`${start}(?:added|adding|adds)\\s+(?:an?|one|two|three|\\d{1,2})\\s+(?:extra\\s+|more\\s+|new\\s+|additional\\s+)?days?${end}`, "iu"),
  new RegExp(`${start}(?:trip|itinerary|plan)\\s+(?:is\\s+|now\\s+has\\s+)?now\\s+\\d{1,2}\\s+days${end}`, "iu"),
  new RegExp(`${start}(?:(?:extiende|alarga|amplía)\\s+(?:el|tu)\\s+viaje|un\\s+día\\s+más|(?:añadido|agregado|añadí|agregué)\\s+(?:un|dos|tres|\\d{1,2})\\s+días?)${end}`, "iu"),
  new RegExp(`${start}(?:(?:allunga|allungato|estende|esteso|prolunga|prolungato)\\s+il\\s+(?:tuo\\s+)?viaggio|un\\s+giorno\\s+in\\s+più|aggiunt[oi]\\s+(?:un|due|tre|\\d{1,2})\\s+giorn[oi])${end}`, "iu"),
  new RegExp(`${start}(?:(?:estende|prolonga|alonga)\\s+a\\s+(?:sua\\s+)?viagem|mais\\s+um\\s+dia|(?:adicionei|acrescentei)\\s+(?:um|dois|três|\\d{1,2})\\s+dias?)${end}`, "iu"),
];

/** Does this reply say the trip got longer? */
export function claimsLongerTrip(text: string | null | undefined): boolean {
  return !!text && LONGER_TRIP.some((re) => re.test(text));
}

/** Appended when a change concerned more days than could be prepared in time. */
export function daysLeftNote(language: string | undefined, days: number[]): string {
  const list = days.join(", ");
  switch (lang(language)) {
    case "es":
      return `(Los días ${list} aún no han cambiado: di "continúa" y haré lo mismo allí.)`;
    case "it":
      return `(I giorni ${list} non sono ancora cambiati: scrivi "continua" e farò lo stesso lì.)`;
    case "pt":
      return `(Os dias ${list} ainda não mudaram: diga "continue" e faço o mesmo neles.)`;
    default:
      return `(Days ${list} aren't changed yet: say "continue" and I'll do the same there.)`;
  }
}

/** Appended when a longer trip got some of its new days but not the last ones in time. */
export function daysNotAddedNote(language: string | undefined, days: number[]): string {
  const one = days.length === 1;
  const list = days.join(", ");
  switch (lang(language)) {
    case "es":
      return one
        ? `(El día ${list} aún no está añadido: di "continúa" y lo añadiré.)`
        : `(Los días ${list} aún no están añadidos: di "continúa" y los añadiré.)`;
    case "it":
      return one
        ? `(Il giorno ${list} non è ancora aggiunto: scrivi "continua" e lo aggiungerò.)`
        : `(I giorni ${list} non sono ancora aggiunti: scrivi "continua" e li aggiungerò.)`;
    case "pt":
      return one
        ? `(O dia ${list} ainda não foi adicionado: diga "continue" e eu o adiciono.)`
        : `(Os dias ${list} ainda não foram adicionados: diga "continue" e eu os adiciono.)`;
    default:
      return one
        ? `(Day ${list} isn't added yet: say "continue" and I'll add it.)`
        : `(Days ${list} aren't added yet: say "continue" and I'll add them.)`;
  }
}

/**
 * Appended when a changed day still plans something outside the hours around
 * an arrival or a departure, after the model was asked to fix it.
 */
export function travelTimesNote(
  language: string | undefined,
  v: { day: number; arrives?: string; leaves?: string; from: string | null; until: string | null; names: string[] },
): string {
  const names = v.names.join(", ");
  const late = v.from !== null && v.from >= "22:00";
  const d = v.day;
  switch (lang(language)) {
    case "es":
      return v.leaves
        ? `(Revisa el día ${d}: sales a las ${v.leaves}, así que los planes deberían terminar a las ${v.until}, y el día aún tiene: ${names}.)`
        : late
          ? `(Revisa el día ${d}: llegas a las ${v.arrives}, demasiado tarde para hacer planes, y el día aún tiene: ${names}.)`
          : `(Revisa el día ${d}: llegas a las ${v.arrives}, así que los planes deberían empezar después de las ${v.from}, y el día aún tiene: ${names}.)`;
    case "it":
      return v.leaves
        ? `(Controlla il giorno ${d}: parti alle ${v.leaves}, quindi i programmi dovrebbero finire entro le ${v.until}, e il giorno ha ancora: ${names}.)`
        : late
          ? `(Controlla il giorno ${d}: arrivi alle ${v.arrives}, troppo tardi per altri programmi, e il giorno ha ancora: ${names}.)`
          : `(Controlla il giorno ${d}: arrivi alle ${v.arrives}, quindi i programmi dovrebbero iniziare dopo le ${v.from}, e il giorno ha ancora: ${names}.)`;
    case "pt":
      return v.leaves
        ? `(Confira o dia ${d}: você parte às ${v.leaves}, então os planos deveriam terminar até as ${v.until}, e o dia ainda tem: ${names}.)`
        : late
          ? `(Confira o dia ${d}: você chega às ${v.arrives}, tarde demais para outros planos, e o dia ainda tem: ${names}.)`
          : `(Confira o dia ${d}: você chega às ${v.arrives}, então os planos deveriam começar depois das ${v.from}, e o dia ainda tem: ${names}.)`;
    default:
      return v.leaves
        ? `(Check Day ${d}: you leave at ${v.leaves}, so plans should end by ${v.until}, and the day still has: ${names}.)`
        : late
          ? `(Check Day ${d}: you arrive at ${v.arrives}, too late for other plans, and the day still has: ${names}.)`
          : `(Check Day ${d}: you arrive at ${v.arrives}, so plans should start after ${v.from}, and the day still has: ${names}.)`;
  }
}

/**
 * The trip page's answer when an editor asked for more days: they move the
 * trip's dates, which stay with the owner. The days made anyway are listed as
 * ideas: "Here are some ideas for Day 4 and Day 5" was followed by none.
 */
export function ownerAddsDaysReply(language: string | undefined, days: number, ideas: string[]): string {
  const list = ideas.map((idea) => `\n- ${idea}`).join("");
  switch (lang(language)) {
    case "es":
      return `Solo el propietario del viaje puede añadir días, así que el viaje sigue teniendo ${days} días.${list && ` Ideas para esos días, para proponérselas:${list}`}`;
    case "it":
      return `Solo il proprietario del viaggio può aggiungere giorni, quindi il viaggio resta di ${days} giorni.${list && ` Idee per quei giorni, da proporgli:${list}`}`;
    case "pt":
      return `Só o proprietário da viagem pode adicionar dias, então a viagem continua com ${days} dias.${list && ` Ideias para esses dias, para sugerir ao proprietário:${list}`}`;
    default:
      return `Only the trip owner can add days, so the trip stays at ${days} days.${list && ` Ideas for those days, to suggest to them:${list}`}`;
  }
}

/**
 * Follows a trip-page reply that talks as if a change waiting for the button
 * were already saved. The reply comes first: it is the answer.
 */
export function pendingChangeNote(language: string | undefined, buttonLabel: string): string {
  switch (lang(language)) {
    case "es":
      return `Aún no guardado: toca "${buttonLabel}" abajo para actualizar tu viaje.`;
    case "it":
      return `Non ancora salvato: tocca "${buttonLabel}" qui sotto per aggiornare il tuo viaggio.`;
    case "pt":
      return `Ainda não salvo: toque em "${buttonLabel}" abaixo para atualizar a sua viagem.`;
    default:
      return `Not saved yet: tap "${buttonLabel}" below to update your trip.`;
  }
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

// Asking for something to go: "remove", "take out", "instead", "quita", "togli"…
const REMOVAL_ASK = new RegExp(
  `${start}${words(
    "remove|removing|take\\s+out|delete|drop|skip|cut|get\\s+rid|without|replace|replacing|instead|swap|no\\s+more|quita|quitar|elimina|eliminar|borra|sin|en\\s+vez|en\\s+lugar|sustituye|cambia|togli|togliere|rimuovi|cancella|senza|invece|sostituisci|tira|tirar|remova|exclua|apaga|sem|em\\s+vez|troca|substitua"
  )}${end}`,
  "iu"
);

/** Does the traveller's message ask for something to be taken out or swapped? */
export function asksToRemove(message: string | null | undefined): boolean {
  return REMOVAL_ASK.test(message ?? "");
}

/**
 * Names the activities a change takes out when the traveller only asked to
 * add or adjust: "add a Jameson tour" quietly replaced a Guinness visit.
 */
export function takesOutNote(language: string | undefined, names: string[]): string {
  const list = names.slice(0, 4).join(", ") + (names.length > 4 ? ", …" : "");
  switch (lang(language)) {
    case "es":
      return `(Este cambio quita: ${list}.)`;
    case "it":
      return `(Questa modifica toglie: ${list}.)`;
    case "pt":
      return `(Esta alteração tira: ${list}.)`;
    default:
      return `(This change takes out: ${list}.)`;
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
