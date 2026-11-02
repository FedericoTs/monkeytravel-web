/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isAffirmative } from "./AIAssistantEnhanced";
import { applyButtonLabel } from "@/lib/ai/assistant/apply-button";

/**
 * The assistant tells the user to tap a button by name. The card renders
 * `common.ai.preview.applyChange`, and the assistant route reads the same key
 * through applyButtonLabel(). A mismatch would put "tap Save to my trip"
 * beside a button reading something else, which is precisely the kind of
 * small mismatch a distracted reader cannot get past.
 */
const LOCALES = ["en", "es", "it", "pt"] as const;

function commonMessages(locale: string) {
  return JSON.parse(readFileSync(join(process.cwd(), "messages", locale, "common.json"), "utf8"));
}

describe("the prompt names the button exactly as the button is labelled", () => {
  it.each(LOCALES)("%s", async (locale) => {
    expect(await applyButtonLabel(locale)).toBe(commonMessages(locale).ai.preview.applyChange);
  });

  it.each([
    ["pt-BR", "pt"],
    ["ES", "es"],
    ["fr", "en"],
    ["", "en"],
    [undefined, "en"],
  ])("reads %j as %s", async (language, locale) => {
    expect(await applyButtonLabel(language)).toBe(commonMessages(locale).ai.preview.applyChange);
  });

  it.each(LOCALES)("the helper text in %s names the real button", (locale) => {
    const messages = commonMessages(locale);
    // It used to read 'Click "Apply" to confirm this change to your trip',
    // naming a button that no longer exists anywhere on the card.
    expect(messages.ai.preview.helperText).toContain(messages.ai.preview.applyChange);
  });

  it("says what tapping it does, not what the system calls it", () => {
    // "Apply Change" is the mechanism; "Save to my trip" is the outcome. The
    // old label told the user about the software.
    for (const locale of LOCALES) {
      const messages = commonMessages(locale);
      expect(messages.ai.preview.applyChange).not.toMatch(/apply|aplicar|applica/i);
      // And the card's own title states the state plainly.
      expect(messages.ai.preview.suggestedChange).toBeTruthy();
    }
  });
});

describe("isAffirmative", () => {
  /**
   * Consulted only while a card is on screen showing exactly what will be
   * saved, so a match acts on the user's stated intent. The asymmetry matters:
   * a miss costs one extra tap, a false match writes something they were still
   * negotiating.
   */
  it.each([
    "yes", "Yes", "YES!", "yep", "yeah", "ok", "Okay.", "sure", "do it",
    "go ahead", "please do", "apply it", "save it", "add it", "perfect",
    "sí", "si", "vale", "hazlo", "va bene", "fallo", "sim", "claro", "perfeito",
  ])("treats %j as agreement", (s) => {
    expect(isAffirmative(s)).toBe(true);
  });

  it.each([
    "yes but make it cheaper",
    "ok what about Tuesday",
    "yes, and also add a museum",
    "no",
    "not that one",
    "why did you pick that",
    "sure about the price?",
    "add a cafe near the museum",
    "",
  ])("does not act on %j", (s) => {
    expect(isAffirmative(s)).toBe(false);
  });
});
