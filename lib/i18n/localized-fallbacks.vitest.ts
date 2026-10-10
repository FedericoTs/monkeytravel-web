import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Keys that replaced English shown to es/it/pt visitors (stand-in names, price
 * levels, the wizard's defaults hint, the route toast). Each must exist in every
 * locale, carry en's placeholders and actually be translated.
 */
const LOCALES = ["en", "es", "it", "pt"] as const;

const NEW_KEYS: Record<string, string[]> = {
  "common.json": [
    "collaborators.ownerFallback",
    "collaborators.memberFallback",
    "invitePage.ownerFallback",
    "invitePage.someoneFallback",
    "invitePage.inviterNoteLabel",
    "gallery.priceLevels.free",
    "gallery.priceLevels.inexpensive",
    "gallery.priceLevels.moderate",
    "gallery.priceLevels.expensive",
    "gallery.priceLevels.veryExpensive",
    "activity.startTime",
    "activity.estCost",
    "activity.durationMinutes",
    "activity.about",
    "activity.location",
    "activity.photos",
    "trips.confirmUnarchiveMessage",
  ],
  "trips.json": [
    "wizard.step2.customizeDefaults",
    "wizard.multiCity.startDateAria",
    "wizard.multiCity.nightsTotal",
    "wizard.multiCity.endsOn",
    "detail.routeOptimized",
    "detail.routeOptimizedSave",
    "detail.pageTitle",
    "detail.exitEditing",
    "detail.activityRegenerateFailed",
    "detail.saveChangesFailed",
  ],
};

function load(locale: string, file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(process.cwd(), "messages", locale, file), "utf8"));
}

function valueAt(messages: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], messages);
}

function keysOf(o: unknown, prefix = ""): string[] {
  if (!o || typeof o !== "object" || Array.isArray(o)) return [prefix];
  return Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => keysOf(v, prefix ? `${prefix}.${k}` : k));
}

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)/g)].map((m) => m[1]).sort();

describe.each(Object.entries(NEW_KEYS))("new keys in messages/*/%s", (file, paths) => {
  const en = load("en", file);

  it.each(paths)("%s is translated in every locale with en's placeholders", (path) => {
    const english = valueAt(en, path);
    expect(typeof english).toBe("string");
    for (const locale of LOCALES.slice(1)) {
      const value = valueAt(load(locale, file), path);
      expect(typeof value, `${locale} ${path}`).toBe("string");
      expect((value as string).trim(), `${locale} ${path}`).not.toBe("");
      expect(value, `${locale} ${path} is still English`).not.toBe(english);
      expect(placeholders(value as string), `${locale} ${path}`).toEqual(placeholders(english as string));
    }
  });
});

describe("messages/*/common.json key parity", () => {
  const en = new Set(keysOf(load("en", "common.json")));

  it.each(LOCALES.slice(1))("%s has exactly the keys en has", (locale) => {
    const keys = new Set(keysOf(load(locale, "common.json")));
    const missing = [...en].filter((k) => !keys.has(k)).sort();
    const extra = [...keys].filter((k) => !en.has(k)).sort();
    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
  });
});
