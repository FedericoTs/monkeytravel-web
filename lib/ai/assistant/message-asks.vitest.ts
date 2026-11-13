/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { asksForEveryDay } from "./message-asks";

describe("asksForEveryDay", () => {
  it("hears every day of the trip in the four languages", () => {
    for (const ask of [
      "Suggest restaurants for lunch and dinner every day",
      "add a coffee break each day",
      "fill all the days between meals",
      "Sugerir restaurantes para todos los días",
      "una siesta cada día",
      "aggiungi una cena tutti i giorni",
      "un gelato ogni giorno",
      "Sugira restaurantes para todos os dias no almoço e jantar.",
      "café da manhã no hotel todo dia",
    ]) {
      expect(asksForEveryDay(ask), ask).toBe(true);
    }
  });

  it("hears no such thing in a request about some days", () => {
    for (const ask of ["add a restaurant on day 1", "make the first days lighter", "a day trip to Sintra", "more days in Porto", "everybody wants dinner at 8"]) {
      expect(asksForEveryDay(ask), ask).toBe(false);
    }
  });
});
