// @vitest-environment node
import { describe, it, expect } from "vitest";
import en from "@/messages/en/profile.json";
import es from "@/messages/es/profile.json";
import it_ from "@/messages/it/profile.json";
import pt from "@/messages/pt/profile.json";
import { UNSUB_KEYS } from "@/lib/email/unsubscribe";
import { EMAIL_PREFERENCES } from "@/lib/email/preferences";

/**
 * The notification settings and unsubscribe pages are where every email's
 * "Manage preferences" link lands, in the reader's language. Until
 * 2026-09-25 both were English-only. Every locale carries the same keys, with
 * the same placeholders and link tags, and nothing empty.
 */

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out[path] = value;
    else Object.assign(out, flatten(value, path));
  }
  return out;
}

/** {what} placeholders and <link> tags, sorted. */
const slots = (s: string) =>
  [...s.matchAll(/\{(\w+)\}|<(\w+)>/g)].map((m) => (m[1] ? `{${m[1]}}` : `<${m[2]}>`)).sort();

const OTHERS = { es, it: it_, pt } as const;

describe.each(["notificationSettings", "unsubscribe"] as const)("profile.%s", (block) => {
  const base = flatten(en[block] as Tree);

  it.each(Object.keys(OTHERS) as Array<keyof typeof OTHERS>)(
    "%s has every English key, the same slots, and no empty string",
    (locale) => {
      const other = flatten(OTHERS[locale][block] as Tree);
      expect(Object.keys(other).sort()).toEqual(Object.keys(base).sort());
      for (const [key, value] of Object.entries(other)) {
        expect(value.trim(), `${locale} ${key}`).not.toBe("");
        expect(slots(value), `${locale} ${key}`).toEqual(slots(base[key]));
      }
    }
  );
});

describe("coverage", () => {
  it("every switch on the settings page has a label and a description", () => {
    const toggles = en.notificationSettings.toggles as Record<string, { label: string; description: string }>;
    for (const { key } of EMAIL_PREFERENCES) {
      expect(toggles[key]?.label, key).toBeTruthy();
      expect(toggles[key]?.description, key).toBeTruthy();
    }
    // …and nothing else: no copy for switches that don't exist.
    expect(Object.keys(toggles).sort()).toEqual(EMAIL_PREFERENCES.map((p) => p.key).sort());
  });

  it("every unsubscribe key has a phrase for the unsubscribe page", () => {
    const what = en.unsubscribe.what as Record<string, string>;
    for (const key of Object.keys(UNSUB_KEYS)) expect(what[key], key).toBeTruthy();
  });
});
