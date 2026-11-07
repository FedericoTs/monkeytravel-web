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

function lines(node: unknown, at = ""): [string, string][] {
  if (typeof node === "string") return [[at, node]];
  if (!node || typeof node !== "object") return [];
  return Object.entries(node).flatMap(([key, value]) => lines(value, at ? `${at}.${key}` : key));
}

describe.each(Object.keys(NOT_PROMISED))("messages/%s", (locale) => {
  it("promises only what a plan does", () => {
    const found = PAGES.flatMap((page) =>
      lines(JSON.parse(readFileSync(join(process.cwd(), "messages", locale, `${page}.json`), "utf8")))
        .filter(([, text]) => NOT_PROMISED[locale].some((phrase) => text.toLowerCase().includes(phrase)))
        .map(([key]) => `${page}.${key}`)
    );
    expect(found).toEqual([]);
  });
});
