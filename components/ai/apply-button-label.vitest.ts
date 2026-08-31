/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isAffirmative } from "./AIAssistantEnhanced";

/**
 * The assistant tells the user to tap a button by name. That name is written
 * in two places — the card renders `common.ai.preview.applyChange` from the
 * message files, and the API route (which sits outside [locale]/ and cannot
 * use next-intl) carries its own copy to put in the prompt.
 *
 * Duplication drifts. If it does here the result is an assistant saying "tap
 * Save to my trip" beside a button reading something else, which is precisely
 * the kind of small mismatch a distracted reader cannot get past.
 */
const LOCALES = ["en", "es", "it", "pt"] as const;

/** Mirrors applyButtonLabel() in app/api/ai/assistant/route.ts. */
const ROUTE_LABELS: Record<string, string> = {
  en: "Save to my trip",
  es: "Guardar en mi viaje",
  it: "Salva nel mio viaggio",
  pt: "Guardar na minha viagem",
};

describe("the prompt names the button exactly as the button is labelled", () => {
  it.each(LOCALES)("%s", (locale) => {
    const messages = JSON.parse(
      readFileSync(join(process.cwd(), "messages", locale, "common.json"), "utf8")
    );
    expect(messages.ai.preview.applyChange).toBe(ROUTE_LABELS[locale]);
  });

  it.each(LOCALES)("the helper text in %s names the real button", (locale) => {
    const messages = JSON.parse(
      readFileSync(join(process.cwd(), "messages", locale, "common.json"), "utf8")
    );
    // It used to read 'Click "Apply" to confirm this change to your trip',
    // naming a button that no longer exists anywhere on the card.
    expect(messages.ai.preview.helperText).toContain(messages.ai.preview.applyChange);
  });

  it("says what tapping it does, not what the system calls it", () => {
    // "Apply Change" is the mechanism; "Save to my trip" is the outcome. The
    // old label told the user about the software.
    for (const locale of LOCALES) {
      const messages = JSON.parse(
        readFileSync(join(process.cwd(), "messages", locale, "common.json"), "utf8")
      );
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
