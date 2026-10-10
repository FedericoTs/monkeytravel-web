import { resolveAiLanguage } from "@/lib/ai/language";

/**
 * A new trip's title in the language of the page it was made on. English reads
 * "{destination} Trip"; es/it/pt use the destination alone, because "Viaggio a"
 * needs a different preposition and article per place ("in Giappone", "a Roma").
 */
export function newTripTitle(destination: string, locale: string | null | undefined): string {
  const name = destination.trim();
  return resolveAiLanguage(locale) === "en" ? `${name} Trip` : name;
}
