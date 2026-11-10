/**
 * Keeps the trip assistant from telling someone it changed their itinerary
 * when nothing changed.
 *
 * WHY
 * Replies like "Your Day 5 itinerary has been updated to include…" or "I've
 * added the train journey to your Day 1 itinerary", with no change prepared or
 * saved, tell someone their plan changed when it didn't; they find out on the
 * page, and stop trusting the trip.
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

import { resolveAiLanguage, type SupportedLanguage } from "@/lib/ai/language";
import { note } from "./notes";
import { applyButtonLabel } from "./apply-button";
import type { StructuredAssistantResponse } from "@/types";

const L = "\\p{L}";
/** Word boundaries that also hold around accented letters (JS \b is ASCII-only). */
const start = `(?<![${L}'’])`;
const end = `(?![${L}])`;
const words = (list: string) => `(?:${list})`;

// Restructuring verbs (condensed, rearranged…) since the wizard assistant can
// reshape whole trips: "I've condensed your Rome trip into 3 days".
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

// Where a sentence can start, for a claim that opens with its verb.
const SENTENCE_START = `(?:^|[.!?:]\\s+|\\n\\s*)`;

const CLAIM_PATTERNS: RegExp[] = [
  // With no subject, as a terser model writes: "Added a gelato stop to Day 2".
  new RegExp(`${SENTENCE_START}${words("added|updated|removed|replaced|moved|changed|swapped|deleted|rescheduled|shifted")}\\s+(?:an?|the|your(?!\\s+mind)|some|one|two|three|\\d+)${end}`, "iu"),
  new RegExp(`${SENTENCE_START}${words("añadid[oa]s?|agregad[oa]s?|actualizad[oa]s?|eliminad[oa]s?|quitad[oa]s?|reemplazad[oa]s?|sustituid[oa]s?|cambiad[oa]s?|movid[oa]s?")}\\s+(?:una?|el|la|los|las|tus?|\\d+)${end}`, "iu"),
  new RegExp(`${SENTENCE_START}${words("aggiunt[oaie]|aggiornat[oaie]|rimoss[oaie]|eliminat[oaie]|tolt[oaie]|sostituit[oaie]|spostat[oaie]|cambiat[oaie]")}\\s+(?:(?:un[oa]?|il|lo|la|i|gli|le|\\d+)${end}|(?:l|un)['’])`, "iu"),
  new RegExp(`${SENTENCE_START}${words("adicionad[oa]s?|acrescentad[oa]s?|atualizad[oa]s?|removid[oa]s?|retirad[oa]s?|substituíd[oa]s?|trocad[oa]s?|mudad[oa]s?|movid[oa]s?")}\\s+(?:uma?|o|a|os|as|seus?|suas?|\\d+)${end}`, "iu"),
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
];

// Promises (see EN_PROMISE_VERBS above)
const PROMISE_PATTERNS: RegExp[] = [
  new RegExp(`${start}(?:i(?:['’]ll|\\s+will)|let\\s+me|i(?:['’]m|\\s+am)\\s+(?:going|preparing|about)\\s+to)\\s+(?:now\\s+|just\\s+|also\\s+|go\\s+ahead\\s+and\\s+)?${EN_PROMISE_VERBS}${end}`, "iu"),
  new RegExp(`${start}(?<!no\\s)(?:voy\\s+a\\s+(?:lo\\s+|la\\s+|los\\s+|las\\s+)?${ES_INFINITIVES}|${ES_INFINITIVES}é)${end}`, "iu"),
  new RegExp(`${start}(?<!non\\s)(?:${IT_FUTURES}|sto\\s+per\\s+${IT_INFINITIVES})${end}`, "iu"),
  new RegExp(`${start}(?<!não\\s)(?:vou\\s+${PT_INFINITIVES}|${PT_FUTURES})${end}`, "iu"),
];

// A promise that waits for something from the traveller is not a claim: "Once
// you send me the list, I'll add each one", "assim que você me enviar os nomes".
const WAITS_FOR_THEM = new RegExp(
  `${start}(?:${[
    "(?:once|when|as\\s+soon\\s+as|after|if)\\s+you(?:['’]ve)?\\s+(?:send|sent|tell|told|share|shared|give|given|list|paste|let\\s+me\\s+know|confirm|choose|pick|decide)",
    "(?:quando|assim\\s+que|logo\\s+que|depois\\s+que|se|caso)\\s+(?:você\\s+)?(?:me\\s+)?(?:enviar|envie|mandar|mande|passar|passe|disser|diga|informar|informe|listar|compartilhar|indicar|escolher|confirmar)",
    "(?:cuando|en\\s+cuanto|apenas|una\\s+vez\\s+que|si)\\s+(?:me\\s+)?(?:envíes|envías|mandes|mandas|pases|pasas|digas|dices|indiques|indicas|compartas|compartes|confirmes|confirmas|elijas|eliges)",
    "(?:quando|appena|non\\s+appena|una\\s+volta\\s+che|se)\\s+(?:mi\\s+)?(?:mandi|invii|dici|indichi|scrivi|condividi|confermi|scegli)",
  ].join("|")})${end}`,
  "iu"
);

/** Does this reply say the itinerary was (or now is, or will be) changed? */
export function claimsItineraryChange(text: string | null | undefined): boolean {
  if (!text) return false;
  if (CLAIM_PATTERNS.some((re) => re.test(text))) return true;
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .some((sentence) => !WAITS_FOR_THEM.test(sentence) && PROMISE_PATTERNS.some((re) => re.test(sentence)));
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

// Short words each language uses all the time and the others rarely do.
const COMMON_WORDS: Record<SupportedLanguage, Set<string>> = {
  en: new Set("the and your you with this here have has is are to of for on at day days added from will can".split(" ")),
  es: new Set("el los las del y para con tu tus aquí día días más muy he está son es por una un al como también hay".split(" ")),
  it: new Set("il gli della delle dei che ho ecco più molto per giorno giorni è sono una un tuo tua ai anche alla nel con".split(" ")),
  pt: new Set("os do da dos das em com você seu sua aqui mais muito é são dia dias não ao uma um também na para".split(" ")),
};

/**
 * The language a reply is written in, or undefined when unsure. The model
 * answers in the traveller's language, which can differ from the plan's.
 */
export function replyLanguage(text: string): SupportedLanguage | undefined {
  const words = text.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean);
  const scores = (Object.keys(COMMON_WORDS) as SupportedLanguage[])
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
  return note(language, "nothingChanged");
}

/**
 * Appended when an answer handed over a change that could not be attached. The
 * concierge streams its words before it knows whether the change came with them.
 */
export function noProposalNote(language: string | undefined): string {
  return note(language, "noProposal");
}

/**
 * The reply when a change is prepared but the model's words claimed it done.
 * It stays true once the change is applied; pendingChangeNote, beside it while
 * the change waits, names the button.
 */
export function preparedChangeReply(language: string | undefined): string {
  return note(language, "preparedChange");
}

/**
 * The wizard assistant's reply when it prepared nothing but claimed a change.
 * The wizard has no "Edit Trip" button; its assistant understands every
 * language, so the example is the traveller's own.
 */
export function wizardNothingChangedReply(language: string | undefined): string {
  return note(language, "wizardNothingChanged");
}

/** Places offered for the whole trip, under a reply that claimed the trip already moved. */
export function elsewhereNote(language: string | undefined): string {
  return note(language, "elsewhereNote");
}

/**
 * Appended when the reply talks about days its edit does not include, e.g. a
 * "swap" that only prepared one side of it.
 */
export function uncoveredDaysNote(language: string | undefined, covered: number[], uncovered: number[]): string {
  return note(language, "uncoveredDays", { covered: covered.join(", "), uncovered: uncovered.join(", ") });
}

/**
 * Opens a wizard reply that talks as if a prepared edit were already done
 * ("I've updated Day 2"). Read first, so the Apply button isn't skipped; the
 * label is the wizard's button (trips.assistant.apply in each locale).
 */
export function notAppliedLead(language: string | undefined): string {
  return note(language, "notAppliedLead");
}

/** The assistant's reply when the only change asked was to a fixed plan, which stays as it was. */
export function lockedDayReply(language: string | undefined, dayNumber: number, names: string[]): string {
  return note(language, "lockedDay", { day: String(dayNumber), fixed: names.join(", ") });
}

/** Appended when places of another city came off a city's days. */
export function cityKeptNote(language: string | undefined, other: string, city: string, names: string[]): string {
  return note(language, "cityKept", { other, city, list: names.join(", ") });
}

/** Appended when a change would have moved or taken out a fixed plan, which stays as it was. */
export function fixedKeptNote(language: string | undefined, dayNumber: number, names: string[]): string {
  return note(language, "fixedKept", { day: String(dayNumber), fixed: names.join(", ") });
}

/** The wizard assistant's fallbacks when the model returned no reply text. */
export function wizardFallbackReply(language: string | undefined, prepared: boolean): string {
  return note(language, prepared ? "wizardFallbackPrepared" : "wizardFallbackIdle");
}

/** Appended when the reply meant to change the trip's length but couldn't. */
export function lengthUnchangedNote(language: string | undefined, days: number): string {
  return note(language, "lengthUnchanged", { days });
}

/** Places of a list they asked to add that the change doesn't hold, named after the reply. */
export function listMissingNote(language: string | undefined, names: string[]): string {
  return note(language, "listMissing", { list: names.join(", ") });
}

/** A new change that also holds the one still waiting for its button. */
export function waitingKeptNote(language: string | undefined): string {
  return note(language, "waitingKept");
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
  return note(language, "nothingKept");
}

// An answer that announces figures or a list, then stops: "Ecco un calcolo
// del costo totale stimato per il tuo viaggio." with no number after it.
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

// The whole trip's length as a reply gives it: "your trip to have 16 days",
// "a 16-day itinerary", "il viaggio a 16 giorni". A city's share of the days
// ("Paris gets 4 days", "a 3-day stay") isn't the trip's.
const TRIP_DAYS: RegExp[] = [
  /(?<![\p{L}\p{N}])(?:trip|itinerary|plan|journey)\s+(?:now\s+)?(?:to\s+have|has|have|of|is|lasts|spans|covers)\s+(?:now\s+)?(?:a\s+total\s+of\s+)?(\d{1,2})\s+(?:full\s+)?days(?!\p{L})/iu,
  /(?<![\p{L}\p{N}])(?:extend(?:ed)?|lengthen(?:ed)?|expand(?:ed)?|updated|changed|increased)\s+(?:your\s+|the\s+)?(?:trip|itinerary|plan)\s+to\s+(\d{1,2})\s+days(?!\p{L})/iu,
  /(?<![\p{L}\p{N}])(\d{1,2})[-\s]day\s+(?:trip|itinerary|plan|journey)(?!\p{L})/iu,
  /(?<![\p{L}\p{N}])(?:viaggio|itinerario|piano)\s+(?:ora\s+)?(?:di|a|ha|dura)\s+(\d{1,2})\s+giorni(?!\p{L})/iu,
  /(?<![\p{L}\p{N}])(?:viaje|itinerario|plan)\s+(?:ahora\s+)?(?:de|a|tiene|dura)\s+(\d{1,2})\s+días(?!\p{L})/iu,
  /(?<![\p{L}\p{N}])(?:viagem|roteiro|itinerário|plano)\s+(?:agora\s+)?(?:de|para|tem|dura)\s+(\d{1,2})\s+dias(?!\p{L})/iu,
];

/** How many days this reply says the whole trip has, or null when it says none. */
export function claimedTripDays(text: string | null | undefined): number | null {
  if (!text) return null;
  for (const re of TRIP_DAYS) {
    const m = re.exec(text);
    if (m) return Number(m[1]);
  }
  return null;
}

// A count of days a reply states: "28 Nov to 6 Dec is indeed 8 days total", "9
// days in total", "let's count it as 8 days", "son 8 días", "sono 9 giorni",
// "são 9 dias". An offer ("an 8-day trip instead") states none.
const STATED_DAYS: RegExp[] = [
  /(?<![\p{L}])(?:is|are|it['’]s|that['’]s|makes|spans|comes\s+to|count\s+it\s+as|counts\s+as)\s+(?:indeed\s+|actually\s+|exactly\s+|really\s+|in\s+fact\s+|only\s+|just\s+|still\s+)?(\d{1,2})\s+days(?![\p{L}'’])/giu,
  /(?<![\p{L}\p{N}])(\d{1,2})\s+days\s+(?:in\s+)?total(?![\p{L}])/giu,
  /(?<![\p{L}])(?:son|es|serían|suman)\s+(?:en\s+realidad\s+|exactamente\s+|realmente\s+|efectivamente\s+|solo\s+)?(\d{1,2})\s+días(?![\p{L}])/giu,
  /(?<![\p{L}\p{N}])(\d{1,2})\s+días\s+en\s+total(?![\p{L}])/giu,
  /(?<![\p{L}])(?:sono|è|fanno)\s+(?:in\s+realtà\s+|esattamente\s+|davvero\s+|effettivamente\s+|solo\s+)?(\d{1,2})\s+giorni(?![\p{L}])/giu,
  /(?<![\p{L}\p{N}])(\d{1,2})\s+giorni\s+in\s+totale(?![\p{L}])/giu,
  /(?<![\p{L}])(?:são|é|dá|dão|somam)\s+(?:na\s+verdade\s+|exatamente\s+|realmente\s+|mesmo\s+|só\s+|apenas\s+)?(\d{1,2})\s+dias(?![\p{L}])/giu,
  /(?<![\p{L}\p{N}])(\d{1,2})\s+dias\s+(?:no\s+total|ao\s+todo)(?![\p{L}])/giu,
];

/** Every count of days the reply states for the trip or its dates. */
export function statedDayCounts(text: string | null | undefined): number[] {
  if (!text) return [];
  return STATED_DAYS.flatMap((re) => [...text.matchAll(re)].map((m) => Number(m[1])));
}

/** A trip's first and last dates and its number of days, as notes give them. */
export interface TripSpan {
  from: string;
  to: string;
  days: number;
}

function spanValues(language: string | undefined, span: TripSpan) {
  const format = new Intl.DateTimeFormat(resolveAiLanguage(language), { day: "numeric", month: "long", timeZone: "UTC" });
  const date = (iso: string) => format.format(new Date(`${iso}T00:00:00Z`));
  return { from: date(span.from), to: date(span.to), days: span.days, nights: Math.max(0, span.days - 1) };
}

/** The reply when nothing changes and it gave the trip another count, or a shorter trip nobody asked for. */
export function dayCountReply(language: string | undefined, span: TripSpan): string {
  return note(language, "dayCount", spanValues(language, span));
}

/** Appended when a change's reply gives the trip another count than its dates. */
export function dayCountNote(language: string | undefined, span: TripSpan): string {
  return note(language, "dayCountNote", spanValues(language, span));
}

/** Appended when a change concerned more days than could be prepared in time. */
export function daysLeftNote(language: string | undefined, days: number[]): string {
  return note(language, "daysLeft", { list: days.join(", ") });
}

/** Appended when a longer trip got some of its new days but not the last ones in time. */
export function daysNotAddedNote(language: string | undefined, days: number[]): string {
  return note(language, "daysNotAdded", { count: days.length, list: days.join(", ") });
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
  const day = String(v.day);
  if (v.leaves) return note(language, "travelTimesLeaves", { day, leaves: v.leaves, until: String(v.until), names });
  if (v.from !== null && v.from >= "22:00") return note(language, "travelTimesLate", { day, arrives: String(v.arrives), names });
  return note(language, "travelTimesArrives", { day, arrives: String(v.arrives), from: String(v.from), names });
}

/**
 * The trip page's answer when an editor asked for more days: they move the
 * trip's dates, which stay with the owner. The days made anyway are listed as
 * ideas: "Here are some ideas for Day 4 and Day 5" was followed by none.
 */
export function ownerAddsDaysReply(language: string | undefined, days: number, ideas: string[]): string {
  const list = ideas.map((idea) => `\n- ${idea}`).join("");
  const reply = note(language, "ownerAddsDays", { days });
  return list ? `${reply} ${note(language, "ownerAddsDaysIdeas", { list })}` : reply;
}

/**
 * Follows a trip-page reply that talks as if a change waiting for the button
 * were already saved. The reply comes first: it is the answer. It travels
 * beside the reply (pendingNote), and the chat shows it only while that change
 * waits: once applied, cancelled or followed by another reply it would be wrong.
 */
export function pendingChangeNote(language: string | undefined, buttonLabel: string): string {
  return note(language, "pendingChangeNote", { button: buttonLabel });
}

/**
 * Stands in for an announced total that never came: what the plan's
 * activities add up to, in the currency the traveller sees.
 */
export function planCostsReply(
  language: string | undefined,
  costs: { currency: string; total: number; shown?: { currency: string; total: number } }
): string {
  const l = resolveAiLanguage(language);
  const shown = costs.shown ?? costs;
  return note(l, "planCosts", { amount: `${new Intl.NumberFormat(l).format(shown.total)} ${shown.currency}` });
}

// Asking for something to go: "remove", "take out", "instead", "quita", "togli"…
const REMOVAL_ASK = new RegExp(
  `${start}${words(
    "remove|removing|take\\s+out|delete|drop|skip|cut|get\\s+rid|without|replace|replacing|instead|swap|no\\s+more|quita|quite|quitar|elimina|elimine|eliminar|borra|borre|sin|en\\s+vez|en\\s+lugar|sustituye|sustituya|cambia|cambie|togli|tolga|togliere|rimuovi|rimuova|cancella|cancelli|senza|invece|sostituisci|sostituisca|tira|tire|tirar|retire|retirar|remova|exclua|apaga|apague|sem|em\\s+vez|troca|troque|substitua"
  )}${end}`,
  "iu"
);

// Saying what must stay is not asking for it to go: "não substitua o jantar",
// "don't replace the dinner", "sin quitar nada", "senza togliere niente".
const KEPT = new RegExp(
  `${start}${words("don['’]?t|do\\s+not|never|without|não|nao|nunca|sem|no|sin|non|mai|senza")}\\s+(?:[${L}'’]+\\s+){0,3}?${words(
    "remove|removing|take\\s+out|taking\\s+out|delete|deleting|drop|dropping|cut|cutting|replace|replacing|swap|swapping|skip|skipping|lose|losing|touch|touching|change|changing|quites|quitar|quitando|elimines|eliminar|borres|borrar|sustituyas|sustituir|reemplaces|reemplazar|cambies|cambiar|saques|sacar|toques|tocar|togliere|togli|togliendo|rimuovere|rimuovi|eliminare|elimina|cancellare|cancella|sostituire|sostituisci|cambiare|cambia|toccare|tocca|remova|remover|removendo|retire|retirar|tire|tirar|exclua|excluir|apague|apagar|substitua|substituir|troque|trocar|elimine|mexa|mexer|mude|mudar"
  )}${end}`,
  "giu"
);

// Saying how to plan it is not asking for something to go: "cluster it by areas
// instead of jumping around", "en vez de ir de un lado a otro".
const HOW_TO_PLAN = new RegExp(
  `${start}${words("instead\\s+of|en\\s+vez\\s+de|en\\s+lugar\\s+de|invece\\s+di|em\\s+vez\\s+de|ao\\s+inv[eé]s\\s+de")}\\s+(?:[${L}'’]+\\s+){0,3}?${words(
    "around|back\\s+and\\s+forth|all\\s+over|from\\s+place\\s+to\\s+place|de\\s+un\\s+lado\\s+(?:a|para)\\s+otro|de\\s+un\\s+sitio\\s+a\\s+otro|avanti\\s+e\\s+indietro|da\\s+una\\s+parte\\s+all['’]altra|qua\\s+e\\s+l[aà]|de\\s+um\\s+lado\\s+(?:pro|pra|para\\s+o)\\s+outro|indo\\s+e\\s+voltando"
  )}${end}`,
  "giu"
);

/** Does the traveller's message ask for something to be taken out or swapped? */
export function asksToRemove(message: string | null | undefined): boolean {
  return REMOVAL_ASK.test((message ?? "").replace(KEPT, " ").replace(HOW_TO_PLAN, " "));
}

/**
 * Names the activities a change takes out when the traveller only asked to
 * add or adjust: "add a Jameson tour" quietly replaced a Guinness visit.
 */
export function takesOutNote(language: string | undefined, names: string[]): string {
  const list = names.slice(0, 4).join(", ") + (names.length > 4 ? ", …" : "");
  return note(language, "takesOut", { list });
}

/** Stands in for an announced list or summary that never came. */
export function missingAnswerReply(language: string | undefined): string {
  return note(language, "missingAnswer");
}

/**
 * The trip assistant's reply as the user may read it: no card or words that
 * show a change as done, no claim of a memory, and the server's action, not the
 * model's. Changes `reply` in place; says whether its words were replaced, and
 * the note about a change waiting for its button.
 */
export async function honestReply(
  reply: StructuredAssistantResponse,
  turn: {
    action: StructuredAssistantResponse["action"];
    /** The edit engine's own words, when they are the reply. */
    engineReply: string | null;
    language: SupportedLanguage;
  }
): Promise<{ guarded: boolean; pendingNote?: string }> {
  const { action, engineReply, language } = turn;
  // Cards that show a change as done ("Activity Replaced", "Added") never
  // reach the reply: nothing is saved on this turn, and the confirm card
  // already shows the before and after. The model writes such cards too, so
  // whatever it produces is filtered.
  const CHANGE_CARDS = new Set(["activity_replacement", "activity_added", "activity_suggestion", "confirmation"]);
  if (Array.isArray(reply.cards)) {
    reply.cards = reply.cards.filter(
      (c) => !CHANGE_CARDS.has((c as { type?: string })?.type ?? "")
    );
  }

  // The words as well as the cards. Nothing was saved on this turn, so the
  // reply may not say otherwise, whatever the prompt got out of the model
  // (the prompt rule alone doesn't hold). lib/ai/assistant/honesty.ts.
  // "Noted" and "recorded" claim a memory this assistant does not have:
  // only the last few messages come back with the next prompt.
  let guarded = false;
  let pendingNote: string | undefined;
  // "Here's the proposal" is true of a prepared change, so it counts only
  // when there is none.
  const claimedChange =
    claimsItineraryChange(reply.summary) ||
    (!action && announcesProposal(reply.summary));
  if (claimedChange || claimsToRemember(reply.summary)) {
    console.warn(
      `[AI Assistant] honesty guard replaced a ${claimedChange ? "change" : "memory"} claim (${action ? "change pending" : "nothing prepared"}): "${String(reply.summary).slice(0, 120)}"`
    );
    // The engine's words are the answer and say what each day gets: they
    // stay, and the truth about the button follows them, just above it.
    // Put first, it read "Not saved yet: … Absolutely! I've extended…".
    // Other words become "I've prepared this change", true before and after
    // the button.
    if (action) {
      reply.summary = engineReply !== null && claimedChange ? engineReply : preparedChangeReply(language);
      pendingNote = pendingChangeNote(language, await applyButtonLabel(language));
    } else {
      reply.summary = claimedChange ? nothingChangedReply(language) : nothingKeptReply(language);
    }
    guarded = true;
  }

  // The action metadata is the SERVER's, unconditionally — including when
  // the server did nothing, in which case it is `undefined` and the model's
  // own claim is discarded.
  //
  // This assignment used to sit behind `if (<the change's card>) ... else if
  // (action)`, so whenever neither existed the model's invented action
  // survived into the response and the saved history. That is how 12
  // "remove_activity ... applied: true" records exist for an intent that has
  // no handler in this file at all: the user asked, nothing ran, and the
  // model filled in the blank from the prompt's own example.
  //
  // Structural actions (add_day / apply_draft) carry no chat card — their
  // confirm-first UI is the client's PendingChange card — but their metadata
  // must still ride the message: it drives the badge and the history.
  reply.action = action;

  return { guarded, pendingNote };
}
