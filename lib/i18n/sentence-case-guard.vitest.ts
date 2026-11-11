import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";

/**
 * Italian, Spanish and Portuguese write labels in sentence case: "Salva
 * viaggio", not "Salva Viaggio". The planner's labels came in English Title
 * Case, which reads as machine-translated. A label whose every word is
 * capitalised fails here; acronyms, brands, a new sentence and lists of tags
 * ("Ostelli · Budget · Social") may keep their capitals.
 */

const KEEP = new Set(["AI", "IA", "MonkeyTravel", "Google", "Maps", "WhatsApp", "PDF", "GPS", "Instagram", "TikTok", "Airbnb", "Wi-Fi", "OK", "UNESCO", "ChatGPT", "Gemini", "Uber", "Hostelworld"]);

function titleCased(value: string): boolean {
  if (value.includes("·")) return false;
  const words = value.replace(/[^\p{L}\s'’-]/gu, " ").split(/\s+/).filter(Boolean);
  if (words.length < 2 || !/^\p{Lu}/u.test(words[0])) return false;
  const rest = words.slice(1).filter((w) => w.length >= 3 && !KEEP.has(w) && !/\p{Lu}{2,}/u.test(w));
  return rest.length > 0 && rest.every((w) => /^\p{Lu}\p{Ll}/u.test(w));
}

function labels(obj: unknown, path = ""): Array<[string, string]> {
  if (typeof obj === "string") return [[path, obj]];
  if (!obj || typeof obj !== "object") return [];
  return Object.entries(obj).flatMap(([key, value]) => labels(value, path ? `${path}.${key}` : key));
}

describe("planner labels in sentence case", () => {
  it.each(["it", "es", "pt"])("%s", (locale) => {
    const messages = JSON.parse(readFileSync(`messages/${locale}/trips.json`, "utf8"));
    const offenders = labels(messages).filter(([, value]) => titleCased(value) && value.length <= 60);
    expect(offenders).toEqual([]);
  });

  it("catches an English-style label and lets real exceptions through", () => {
    expect(titleCased("Salva Viaggio")).toBe(true);
    expect(titleCased("Salva viaggio")).toBe(false);
    expect(titleCased("Assistente viaggio AI")).toBe(false);
    expect(titleCased("Ostelli · Budget · Social")).toBe(false);
  });
});
