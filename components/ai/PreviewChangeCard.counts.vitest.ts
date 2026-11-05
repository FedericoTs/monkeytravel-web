import { describe, expect, it } from "vitest";
import { createTranslator } from "next-intl";
import en from "@/messages/en/common.json";
import es from "@/messages/es/common.json";
import it_ from "@/messages/it/common.json";
import pt from "@/messages/pt/common.json";

/** A count of one reads as one, in every language: "1 day", not "1 days". */

const languages = [
  ["en", en, ["1 day", "2 days"], ["1 activity", "2 activities"], ["1 day updated", "2 days updated"]],
  ["es", es, ["1 día", "2 días"], ["1 actividad", "2 actividades"], ["1 día actualizado", "2 días actualizados"]],
  ["it", it_, ["1 giorno", "2 giorni"], ["1 attività", "2 attività"], ["1 giorno aggiornato", "2 giorni aggiornati"]],
  ["pt", pt, ["1 dia", "2 dias"], ["1 atividade", "2 atividades"], ["1 dia atualizado", "2 dias atualizados"]],
] as const;

describe.each(languages)("the counts on a proposed change, in %s", (locale, common, days, activities, updated) => {
  const t = createTranslator({ locale, messages: { common }, namespace: "common.ai" }) as unknown as (
    key: string,
    values: { count: number }
  ) => string;
  const both = (key: string) => [t(key, { count: 1 }), t(key, { count: 2 })];

  it("days", () => expect(both("preview.daysCount")).toEqual(days));
  it("activities", () => expect(both("preview.activitiesCount")).toEqual(activities));
  it("days updated", () => expect(both("assistant.actionBadge.daysUpdated")).toEqual(updated));
});
