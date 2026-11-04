import { LANGUAGE_NAMES, type SupportedLanguage } from "@/lib/ai/language";

/**
 * The assistant's language line: shorter than the trip prompt's
 * getLanguageInstruction (lib/ai/trip-prompt.ts), which also sets formats.
 */
export function chatLanguageInstruction(language: SupportedLanguage): string {
  if (language === "en") return "";

  const instructions: Record<Exclude<SupportedLanguage, "en">, string> = {
    es: `\n\nIMPORTANTE: Responde COMPLETAMENTE en espanol. Los nombres de actividades, descripciones, consejos y el resumen deben estar en espanol.`,
    it: `\n\nIMPORTANTE: Rispondi COMPLETAMENTE in italiano. I nomi delle attivita, le descrizioni, i consigli e il riepilogo devono essere in italiano.`,
    pt: `\n\nIMPORTANTE: Responda COMPLETAMENTE em português. Os nomes das atividades, descrições, dicas e o resumo devem estar em português.`,
  };

  return instructions[language];
}

/** The chat reply follows the traveller; itinerary text keeps the trip's language. */
export function replyLanguageRule(tripLanguage: SupportedLanguage): string {
  return `\n\nREPLY LANGUAGE: write your chat reply in the same language as the user's latest message. Itinerary text you write (activity names, descriptions, tips) stays in ${LANGUAGE_NAMES[tripLanguage]}.`;
}
