/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { claimsItineraryChange, nothingChangedReply, pendingChangeReply } from "./honesty";

/**
 * The trip assistant must not say it changed the itinerary when it did not.
 * The first eight cases are real replies from production (2026-09-20..22), each
 * sent with no change prepared or saved.
 */

const productionClaims = [
  "Your Day 5 is now dedicated to cruise embarkation from Civitavecchia. This major change means your Rome itinerary will be extremely condensed.",
  "Your Day 5 itinerary has been updated to include travel from Rome to Civitavecchia and cruise embarkation.",
  "Day 5 will now include travel from Rome to Civitavecchia and your cruise embarkation.",
  "I've added visiting the Three Bells of Fira viewpoint to your Day 7 itinerary",
  "Parea Tavern has been added for dinner on Day 7 in Santorini, ensuring a delightful evening meal.",
  'Understood. I\'ve added a "Fira Caldera Viewpoint" activity to your Day 7 itinerary, right after photographing the Church of Agios Stylianos.',
  "Understood. I've added the train journey to your Day 1 itinerary. It's now scheduled for 12:00 PM after your arrival.",
  "The Borghese Gallery has been removed from Day 5.",
];

const otherLanguageClaims = [
  "He añadido la cena en Parea al día 7.",
  "La cena ha sido añadida al día 7.",
  "El día 5 ahora incluye el traslado a Civitavecchia.",
  "Ho aggiunto una cena al giorno 7.",
  "Il giorno 5 è stato aggiornato con l'imbarco.",
  "La cena è stata aggiunta al giorno 7.",
  "Adicionei o jantar ao dia 7.",
  "O dia 5 foi atualizado com o embarque.",
  "A viagem de comboio foi adicionada ao dia 1.",
];

// The wizard assistant reshapes whole trips; the first is a live reply
// (2026-09-26) for an edit that still waited for Apply.
const restructuringClaims = [
  "No problem! I've condensed your Rome trip into 3 exciting days.",
  "I rearranged Days 1 and 2 so the Vatican comes first.",
  "He reorganizado los días 1 y 2.",
  "Ho accorciato il viaggio a 3 giorni.",
  "Ho scambiato il giorno 1 e il giorno 2.",
  "Encurtei a viagem para 3 dias.",
];

const honest = [
  "Your Rome itinerary would be updated to include the Monument to Victor Emmanuel II on Day 3.",
  "I can add a boat tour to day 5 if you like.",
  'I\'ve lined up adding "Parea Tavern" to Day 7. Tap "Save to my trip" below.',
  "My apologies for the confusion. You are absolutely right, it hasn't been added.",
  "The Colosseum has been standing since 80 AD, so book ahead.",
  "Day 5 currently shows the Borghese Gallery and Gardens.",
  "Puedo añadir un paseo en barco al día 5.",
  "Posso aggiungere un giro in barca al giorno 5.",
  "Posso adicionar um passeio de barco ao dia 5.",
  "No he cambiado nada todavía.",
  "Non ho modificato nulla.",
  "Não alterei nada.",
  // "Reviewed" is not "revised": these only say the plan was checked.
  "I've reviewed your plan and it looks balanced.",
  "He revisado tu plan y está muy bien equilibrado.",
  "Ho rivisto il tuo piano: è ben bilanciato.",
  "Revisei o seu plano e está equilibrado.",
];

describe("claimsItineraryChange", () => {
  it.each(productionClaims)("catches a production false claim: %s", (text) => {
    expect(claimsItineraryChange(text)).toBe(true);
  });

  it.each(otherLanguageClaims)("catches the same claim in es/it/pt: %s", (text) => {
    expect(claimsItineraryChange(text)).toBe(true);
  });

  it.each(restructuringClaims)("catches a restructuring claim: %s", (text) => {
    expect(claimsItineraryChange(text)).toBe(true);
  });

  it.each(honest)("leaves an honest reply alone: %s", (text) => {
    expect(claimsItineraryChange(text)).toBe(false);
  });

  it("is false for nothing at all", () => {
    expect(claimsItineraryChange("")).toBe(false);
    expect(claimsItineraryChange(undefined)).toBe(false);
  });
});

describe("the replies the server puts in their place", () => {
  const languages = ["en", "es", "it", "pt"];

  it.each(languages)("never claim a change themselves (%s)", (lng) => {
    expect(claimsItineraryChange(nothingChangedReply(lng))).toBe(false);
    expect(claimsItineraryChange(pendingChangeReply(lng, "Save to my trip"))).toBe(false);
  });

  it.each(languages)("name the trip page's own Edit button, as the page labels it (%s)", (lng) => {
    // Duplicated from the message files (this is an API route, outside
    // next-intl), so drift is caught here.
    const trips = JSON.parse(readFileSync(join(process.cwd(), "messages", lng, "trips.json"), "utf8"));
    expect(nothingChangedReply(lng)).toContain(`"${trips.detail.editTrip}"`);
  });

  it("names the Apply button it was given", () => {
    expect(pendingChangeReply("it", "Salva nel mio viaggio")).toContain('"Salva nel mio viaggio"');
  });

  it("falls back to English for other languages", () => {
    expect(nothingChangedReply("fr")).toBe(nothingChangedReply("en"));
    expect(nothingChangedReply(undefined)).toBe(nothingChangedReply("en"));
  });
});
