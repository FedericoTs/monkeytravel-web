/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  announcedButMissing,
  claimsItineraryChange,
  claimsToRemember,
  missingAnswerReply,
  nothingChangedReply,
  nothingKeptReply,
  notAppliedLead,
  pendingChangeReply,
  planCostsReply,
} from "./honesty";

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
  "Your itinerary is now structured to align with your flight schedule and hotel logistics, optimizing your time by grouping activities efficiently.",
];

// Promises with nothing behind them; the first is a live reply (2026-09-28).
const promises = [
  "I'll update your accommodation to Residencia Livia Milena in Santa Maria for your trip to Espargos, Cape Verde.",
  "Let me move the Vatican to Day 2.",
  "I'm going to add a sunset walk to Day 3.",
  "Actualizaré tu alojamiento en Santa Maria.",
  "Voy a añadir la cena al día 3.",
  "Aggiornerò il giorno 2 con il museo.",
  "Sto per spostare il museo al giorno 3.",
  "Vou atualizar o seu hotel.",
  "Adicionarei o jantar ao dia 3.",
  // A live reply (2026-10-17) with nothing prepared, and its kin.
  "You got it! I'll create a new romantic Austin itinerary for two, focusing on good local food.",
  "Let me build a slower version of Day 2.",
  "Voy a crear un nuevo itinerario para Austin.",
  "Creerò un nuovo itinerario romantico.",
  "Vou criar um novo roteiro para Austin.",
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
  // Offers, questions and refusals are not promises.
  "Would you like me to add a boat tour to day 5?",
  "Tell me the day and I can move it there.",
  "I will not add anything without your say-so.",
  "I'll put together a few options for Day 3.",
  "No voy a cambiar nada sin tu confirmación.",
  "Non aggiornerò nulla senza conferma.",
  "Não vou alterar nada sem a sua confirmação.",
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

  it.each(promises)("catches a promise: %s", (text) => {
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

// Live replies (2026-09-28) to a hotel address and to flight times, each with
// no action; the assistant only sees the last few messages afterwards.
const memoryClaims = [
  "Your accommodation at Parral 14 Boutique in Condesa for your Mexico City trip has been noted.",
  "Your flight times for Mexico City on November 23rd and 27th, 2026, have been recorded. I've identified key considerations for your arrival and departure days to ensure smooth travel.",
  "I've noted that you'll be staying in Santa Maria for the entire trip, even though your flight arrives in Espargos.",
  "Noted! I'll keep that in mind.",
  "He tomado nota de tu hotel en Santa Maria.",
  "Tu vuelo queda anotado.",
  "Ho preso nota del tuo volo.",
  "Tomei nota do seu hotel.",
  "Anotei o voo de regresso.",
];

const notMemoryClaims = [
  "Note that the museum closes at 17:00.",
  "I can't keep that here, but you can add it with Edit Trip.",
  "Good to know! Santa Maria has the best beaches on Sal.",
  "Please note the check-in time on your booking.",
];

describe("claimsToRemember", () => {
  it.each(memoryClaims)("catches a memory claim: %s", (text) => {
    expect(claimsToRemember(text)).toBe(true);
  });

  it.each(notMemoryClaims)("leaves other replies alone: %s", (text) => {
    expect(claimsToRemember(text)).toBe(false);
  });

  it("is false for nothing at all", () => {
    expect(claimsToRemember("")).toBe(false);
    expect(claimsToRemember(null)).toBe(false);
  });
});

describe("nothingKeptReply", () => {
  const languages = ["en", "es", "it", "pt"];

  it.each(languages)("claims neither a change nor a memory (%s)", (lng) => {
    expect(claimsItineraryChange(nothingKeptReply(lng))).toBe(false);
    expect(claimsToRemember(nothingKeptReply(lng))).toBe(false);
  });

  it.each(languages)("names the trip page's own Edit button (%s)", (lng) => {
    const trips = JSON.parse(readFileSync(join(process.cwd(), "messages", lng, "trips.json"), "utf8"));
    expect(nothingKeptReply(lng)).toContain(`"${trips.detail.editTrip}"`);
  });

  it("falls back to English", () => {
    expect(nothingKeptReply("de")).toBe(nothingKeptReply("en"));
  });
});

describe("claims the guard used to miss", () => {
  // Trip-assistant replies sent with nothing prepared or saved.
  const missed = [
    "This update integrates Akihabara into your Tokyo days.",
    "Day 3, now with a sunset cruise on the Seine.",
    "I'm preparing to add Akihabara to Day 2.",
    "I will reconfigure your Day 4 around the museum.",
  ];
  it.each(missed)("catches: %s", (text) => {
    expect(claimsItineraryChange(text)).toBe(true);
  });

  const offers = [
    "I can integrate a food tour if you like.",
    "Akihabara is great now with the autumn sales on.",
    "Would you like me to reorder Day 2?",
  ];
  it.each(offers)("leaves an offer alone: %s", (text) => {
    expect(claimsItineraryChange(text)).toBe(false);
  });
});

describe("wizard replies that read as done before Apply", () => {
  // Shapes of live wizard replies that went out without the "Not applied yet"
  // lead while their edit still waited for Apply; places are replaced.
  const readAsDone = [
    "Got it! Day 1 now reflects your later arrival time and includes check-in at your hotel.",
    "Excellent choice! I've incorporated the spa visit into your Day 1.",
    "You're right, Day 2 was getting full! I've shifted some activities around.",
    "No problem at all! I've reverted the activities to your original budget.",
    "The museum visit has been cleared from Day 3.",
    "Here are the updated days.",
    "No problem! Here's a revised Day 2 with a full-day island tour.",
    "Excellent idea! Here's an updated Day 1 that includes time for shopping.",
    "No problem! Here's your updated Day 1, including a stop after you land.",
    "Got it! Here's an updated plan that extends your trip to 7 days.",
    "Here's a revised 9-day plan with the two new cities.",
    "¡Claro! He unificado los tres pueblos en el Día 4.",
    "¡Claro! He intercambiado el contenido del Día 3 y el Día 4.",
    "¡Claro! He modificado el día 6 para incluir el jardín botánico.",
    "¡Claro! He incorporado el free tour en tu día 2.",
    "¡Claro! Aquí tienes el día 3 actualizado con las actividades que pediste.",
    "Ho incorporato il museo nel giorno 2.",
    "Ecco il giorno 3 aggiornato con la cena.",
    "Ecco l'itinerario aggiornato.",
    "Incorporei o museu no dia 2.",
    "Aqui está o seu dia 3 atualizado.",
  ];
  it.each(readAsDone)("catches: %s", (text) => {
    expect(claimsItineraryChange(text)).toBe(true);
  });

  const suggestions = [
    "Here are some ideas for Day 3.",
    "Here's what Day 2 looks like right now.",
    "Here are some new activities you could add to Day 3.",
    "I can incorporate a food tour into Day 2 if you like.",
    "Your plan reflects your arrival time.",
    "Aquí tienes algunas ideas para el día 3.",
    "Ecco alcune idee per il giorno 3.",
    "Aqui estão algumas ideias para o dia 3.",
  ];
  it.each(suggestions)("leaves a suggestion alone: %s", (text) => {
    expect(claimsItineraryChange(text)).toBe(false);
  });
});

describe("notAppliedLead", () => {
  it("names the wizard's Apply button in each language", () => {
    expect(notAppliedLead("en")).toContain('"Apply change"');
    expect(notAppliedLead("es")).toContain('"Aplicar cambio"');
    expect(notAppliedLead("it")).toContain('"Applica modifica"');
    expect(notAppliedLead("pt")).toContain('"Aplicar alteração"');
  });
});

describe("the trip assistant's card filter", () => {
  it("drops model-written confirmation cards when nothing was saved", () => {
    const src = readFileSync(join(process.cwd(), "app", "api", "ai", "assistant", "route.ts"), "utf8");
    const set = src.match(/const CHANGE_CARDS = new Set\(\[([^\]]+)\]\)/)?.[1] ?? "";
    expect(set).toContain('"confirmation"');
  });
});

describe("announcedButMissing", () => {
  // The three live replies (2026-10-21) to "Qual è il gran totale": no number in any.
  const empty = [
    "Certo! Ecco un calcolo del costo totale stimato per il tuo viaggio, includendo le informazioni che mi hai fornito finora.",
    "Mi scuso! Sembra che il costo totale non sia stato incluso nella mia risposta precedente. Ecco il calcolo completo per il tuo viaggio stimato.",
    "Mi scuso ancora per l'inconveniente! Ecco il calcolo completo del costo totale stimato per il tuo viaggio.",
    "Sure! Here's a breakdown of the total cost for your trip.",
    "¡Claro! Aquí tienes el cálculo del presupuesto total.",
    "Claro! Aqui está o cálculo do custo total da sua viagem.",
  ];
  it.each(empty)("catches an announced total that never came: %s", (text) => {
    expect(announcedButMissing(text)).toBe("cost");
  });

  it("catches an announced list, and a reply that ends on a colon", () => {
    expect(announcedButMissing("Here's a list of great spots for dinner.")).toBe("other");
    expect(announcedButMissing("These would fit well on day 3:")).toBe("other");
  });

  const answered = [
    "The activities come to about 1,240 EUR; with hostels (8 nights at 20-50 EUR) and flights (800-1,200 EUR) the trip is roughly 2,200-3,100 EUR.",
    "Ecco il calcolo: attività 1.240 EUR, ostelli 160-400 EUR, voli 800-1.200 EUR. Totale circa 2.200-2.840 EUR.",
    "Here's a list of great spots: A Cevicheria, Taberna da Rua das Flores and Cervejaria Ramiro.",
    "Day 3 is the busiest, so book the castle ahead.",
    "I can give you a cost estimate if you tell me your dates.",
    "",
  ];
  it.each(answered)("leaves an answer that gives what it announces alone: %s", (text) => {
    expect(announcedButMissing(text)).toBeNull();
  });
});

describe("the replies that stand in for a missing answer", () => {
  const costs = { currency: "USD", total: 13400, shown: { currency: "EUR", total: 12345 } };

  it("gives the plan's activity total in the currency the traveller sees", () => {
    expect(planCostsReply("en", costs)).toBe(
      "The activities in your plan come to about 12,345 EUR. Hotels and flights aren't in the plan, so add those on top."
    );
    expect(planCostsReply("it", costs)).toContain("circa 12.345 EUR");
    expect(planCostsReply("es", costs)).toContain("unos 12.345 EUR");
    expect(planCostsReply("pt", costs)).toContain("cerca de 12.345 EUR");
    expect(planCostsReply("en", { currency: "USD", total: 13400 })).toContain("13,400 USD");
  });

  it("asks for one thing at a time when a list never came", () => {
    for (const l of ["en", "es", "it", "pt"]) expect(missingAnswerReply(l).length).toBeGreaterThan(20);
    expect(missingAnswerReply("it")).toMatch(/^Non sono riuscito/);
  });
});
