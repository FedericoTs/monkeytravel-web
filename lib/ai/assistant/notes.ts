import { createTranslator } from "next-intl";
import { resolveAiLanguage } from "@/lib/ai/language";
import en from "@/messages/en/assistantNotes.json";
import es from "@/messages/es/assistantNotes.json";
import it from "@/messages/it/assistantNotes.json";
import pt from "@/messages/pt/assistantNotes.json";

const CATALOGS = { en, es, it, pt };

export type NoteKey = keyof typeof en;

/**
 * One of the assistant's own sentences, from messages/<locale>/assistantNotes.json,
 * in the traveller's language (English for any other). The catalogs keep the
 * four languages side by side, where the key-parity and spelling guards see them.
 */
export function note(language: string | undefined, key: NoteKey, values?: Record<string, string | number>): string {
  const locale = resolveAiLanguage(language);
  return createTranslator({ locale, messages: CATALOGS[locale] as typeof en })(key, values);
}
