import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * What the product's pages may not promise, because a plan doesn't do it: plans
 * carry AI cost estimates, nothing checks a place for safety or for children, and
 * the planner has no field for a child's age. If the product gains one of these,
 * take its line out of this list and say what's true.
 *
 * Articles aren't checked: a guide's prices are researched for that guide.
 */

const PAGES = [
  "aiItineraryGenerator",
  "backpacker",
  "budgetTripPlanner",
  "familyTripPlanner",
  "freeTripPlanner",
  "groupTripPlanner",
  "landing",
  "multiCityTripPlanner",
  "soloTripPlanner",
  "trips",
  "weekendTripPlanner",
];

const NOT_PROMISED: Record<string, string[]> = {
  en: ["real prices", "real pricing", "current prices", "actual prices", "actual hotel rates", "real-time availability", "availability checked", "verified data", "verified accommodations", "verified for family", "vetted", "safety ratings", "safe routes", "kids' pricing", "enter each child's age", "data points", "best deals", "thousands of families", "the only ai", "the only free ai", "3 complete itineraries"],
  es: ["precios reales", "precios actuales", "disponibilidad verificados", "datos verificados", "verificada para familias", "verificado para familias", "rutas seguras", "precios para niños", "introduce la edad de cada niño", "miles de datos", "mejores ofertas", "miles de familias", "el único planificador", "3 itinerarios completos"],
  it: ["prezzi reali", "prezzi attuali", "disponibilità verificati", "dati verificati", "verificata per le famiglie", "verificato per famiglie", "percorsi sicuri", "prezzi bambini", "inserire l'età di ogni bambino", "migliaia di dati", "migliori offerte", "migliaia di famiglie", "l'unico pianificatore", "3 itinerari completi"],
  pt: ["preços reais", "preços atuais", "disponibilidade verificados", "dados verificados", "avaliada pensando nas famílias", "avaliado para famílias", "rotas seguras", "preços para crianças", "informar a idade de cada criança", "milhares de dados", "melhores ofertas", "milhares de famílias", "o único planejador", "3 roteiros completos"],
};

/**
 * Features switched off for now: the trip concierge, splitting costs ("Who paid?", "Settle up") and the calendar
 * button (a calendar file stays under Export, so "calendar file" is true and "sync" isn't). No landing page may offer
 * them while they're off. The app's own strings for them (trips) stay until their code goes; when a feature comes
 * back, take its words out of this list.
 */
const SWITCHED_OFF: Record<string, string[]> = {
  en: ["concierge", "who paid", "settle up", "calendar sync", "sync with your calendar", "sync it to your calendar"],
  es: ["concierge", "quién pagó", "liquidar", "sincronización con calendario", "sincroniza con tu calendario", "sincronizarlo con tu calendario"],
  it: ["concierge", "chi ha pagato", "liquidare", "sincronizzazione calendario", "sincronizza con il tuo calendario", "sincronizzarlo con il tuo calendario"],
  pt: ["concierge", "quem pagou", "acertar contas", "sincronização com calendário", "sincronize com o seu calendário", "sincronizá-lo com o seu calendário"],
};
const LANDING_PAGES = PAGES.filter((page) => page !== "trips");

function lines(node: unknown, at = ""): [string, string][] {
  if (typeof node === "string") return [[at, node]];
  if (!node || typeof node !== "object") return [];
  return Object.entries(node).flatMap(([key, value]) => lines(value, at ? `${at}.${key}` : key));
}

/** The keys of `pages` whose text holds one of `phrases`. */
function saying(locale: string, pages: string[], phrases: string[]): string[] {
  return pages.flatMap((page) =>
    lines(JSON.parse(readFileSync(join(process.cwd(), "messages", locale, `${page}.json`), "utf8")))
      .filter(([, text]) => phrases.some((phrase) => text.toLowerCase().includes(phrase)))
      .map(([key]) => `${page}.${key}`)
  );
}

describe.each(Object.keys(NOT_PROMISED))("messages/%s", (locale) => {
  it("promises only what a plan does", () => {
    expect(saying(locale, PAGES, NOT_PROMISED[locale])).toEqual([]);
  });

  it("offers nothing that is switched off", () => {
    expect(saying(locale, LANDING_PAGES, SWITCHED_OFF[locale])).toEqual([]);
  });
});
