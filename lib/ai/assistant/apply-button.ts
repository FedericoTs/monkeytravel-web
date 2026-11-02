import { resolveAiLanguage } from "@/lib/ai/language";

// One catalog per language, loaded the first time that language is asked for.
const COMMON = {
  en: () => import("@/messages/en/common.json"),
  es: () => import("@/messages/es/common.json"),
  it: () => import("@/messages/it/common.json"),
  pt: () => import("@/messages/pt/common.json"),
};

/**
 * The change card's save button as the card labels it
 * (`common.ai.preview.applyChange`), for the replies and the prompt that tell
 * the traveller to tap it. English for any other language.
 */
export async function applyButtonLabel(language: string | undefined): Promise<string> {
  const { default: common } = await COMMON[resolveAiLanguage(language)]();
  return common.ai.preview.applyChange;
}
