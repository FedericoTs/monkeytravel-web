import { describe, it, expect } from "vitest";
import { createTranslator } from "next-intl";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * Guards the trip-reminder email copy against the bug that shipped it broken
 * for two months.
 *
 * WHAT HAPPENED
 * The cron asked for namespace `tripReminderEmail.<slot>`, but i18n.ts mounts
 * messages by FILE — messages/<locale>/common.json becomes the `common`
 * namespace — so the real path is `common.tripReminderEmail.<slot>`. next-intl
 * does not throw on a miss: it logs and substitutes the full key path. So the
 * emails sent, were marked `sent`, and arrived looking like:
 *
 *   Subject: tripReminderEmail.morning_of.heading — Saint Barthélemy
 *   Body:    tripReminderEmail.morning_of.body
 *   Button:  tripReminderEmail.cta
 *
 * Real users received these and two were opened. Nothing caught it: tsc is
 * happy (namespaces are plain strings), the send succeeded, and the only
 * signal was a MISSING_MESSAGE line in the runtime logs that read like noise.
 *
 * These tests pin the two things that have to stay true together: the copy
 * exists where the route expects it, and the route looks where the copy is.
 */

const LOCALES = ["en", "es", "it", "pt"] as const;

// Mirrors TripReminderSlot in lib/email/templates/TripReminder.tsx. Pinned as
// a literal so that adding a slot without adding its copy fails HERE rather
// than by mailing a key path to whoever the new slot fires for.
const SLOTS = [
  "pack_early_14d",
  "visa_check_7d",
  "weather_3d",
  "confirm_1d",
  "morning_of",
] as const;

const ROOT = join(__dirname, "..", "..", "..", "..");

function messagesFor(locale: string): Record<string, unknown> {
  // Built the way i18n.ts builds it: namespace === file basename.
  const raw = readFileSync(
    join(ROOT, "messages", locale, "common.json"),
    "utf8"
  );
  return { common: JSON.parse(raw) };
}

/** Resolve a dotted namespace path the way next-intl would. */
function resolve(tree: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (node, key) =>
        node && typeof node === "object"
          ? (node as Record<string, unknown>)[key]
          : undefined,
      tree
    );
}

describe("trip reminder copy resolves at the path the cron uses", () => {
  for (const locale of LOCALES) {
    for (const slot of SLOTS) {
      it(`${locale}/${slot} has a real heading and body`, () => {
        const tree = messagesFor(locale);
        const node = resolve(tree, `common.tripReminderEmail.${slot}`);

        expect(node, `common.tripReminderEmail.${slot} missing`).toBeTypeOf(
          "object"
        );
        const { heading, body } = node as Record<string, unknown>;

        for (const [name, value] of Object.entries({ heading, body })) {
          expect(value, `${slot}.${name} missing`).toBeTypeOf("string");
          expect((value as string).trim().length).toBeGreaterThan(0);
          // The failure mode was a key path delivered as copy.
          expect(value as string).not.toContain("tripReminderEmail.");
        }
      });
    }

    it(`${locale} has the shared cta label`, () => {
      const cta = resolve(messagesFor(locale), "common.tripReminderEmail.cta");
      expect(cta).toBeTypeOf("string");
      expect((cta as string).trim().length).toBeGreaterThan(0);
    });

    it(`${locale} body interpolates {destination}`, () => {
      // The route calls t("body", { destination }). If a translation drops the
      // placeholder the mail silently loses the destination.
      const node = resolve(
        messagesFor(locale),
        "common.tripReminderEmail.morning_of"
      ) as Record<string, string>;
      expect(node.body).toContain("{destination}");
    });
  }

  it("the copy is NOT reachable at the un-prefixed namespace", () => {
    // The exact mistake: `tripReminderEmail.<slot>` resolves to nothing once
    // the file is mounted as `common`. Asserting the negative keeps the test
    // above honest — otherwise both paths could work and it would prove little.
    expect(resolve(messagesFor("en"), "tripReminderEmail.morning_of")).toBeUndefined();
  });
});

/**
 * The checks above walk the JSON by hand, which only proves the shape of the
 * file — it tests our model of next-intl rather than next-intl. These run the
 * library's own namespace resolution over the real messages, exactly as the
 * route does, and assert on the strings that would actually be mailed.
 */
describe("next-intl itself resolves the reminder copy", () => {
  for (const locale of LOCALES) {
    it(`${locale}: renders real copy for every slot`, () => {
      const messages = messagesFor(locale) as Parameters<
        typeof createTranslator
      >[0]["messages"];

      const raw = resolve(
        messagesFor(locale),
        "common.tripReminderEmail"
      ) as Record<string, Record<string, string>>;

      for (const slot of SLOTS) {
        const t = createTranslator({
          locale,
          messages,
          namespace: `common.tripReminderEmail.${slot}`,
        });
        // Mirrors the route exactly: destination is supplied to BOTH, because
        // weather_3d carries the placeholder in its heading, not its body.
        const rendered = {
          heading: t("heading", { destination: "Lisbon" }),
          body: t("body", { destination: "Lisbon" }),
        };

        for (const [key, value] of Object.entries(rendered)) {
          expect(value, `${locale}/${slot} ${key}`).not.toContain(
            "tripReminderEmail."
          );
          expect(value, `${locale}/${slot} ${key} left braces`).not.toContain(
            "{destination}"
          );
          // Only assert substitution where the source string asks for it —
          // weather_3d's body has no placeholder, the others' headings don't.
          if (raw[slot][key].includes("{destination}")) {
            expect(value, `${locale}/${slot} ${key} substitution`).toContain(
              "Lisbon"
            );
          }
        }
      }

      const ctaT = createTranslator({
        locale,
        messages,
        namespace: "common.tripReminderEmail",
      });
      expect(ctaT("cta")).not.toContain("tripReminderEmail.");
    });
  }

  it("a heading placeholder with no value falls back — the second bug", () => {
    // weather_3d's heading is "Three days to {destination}" in every locale.
    // The route originally called t("heading") bare, and next-intl answers a
    // missing placeholder with the key path, so that slot mailed a broken
    // subject even with the namespace correct. This pins the reason the route
    // passes `destination` to the heading as well as the body.
    const messages = messagesFor("en") as Parameters<
      typeof createTranslator
    >[0]["messages"];
    const t = createTranslator({
      locale: "en",
      messages,
      namespace: "common.tripReminderEmail.weather_3d",
      onError: () => {},
    });
    expect(t("heading")).toContain("tripReminderEmail.weather_3d.heading");
    expect(t("heading", { destination: "Lisbon" })).toBe(
      "Three days to Lisbon"
    );
  });

  it("the OLD namespace returns the key path — the actual failure mode", () => {
    // Reproduces what shipped: next-intl does not throw, it hands back
    // "tripReminderEmail.morning_of.heading", which then became a subject line.
    const messages = messagesFor("en") as Parameters<
      typeof createTranslator
    >[0]["messages"];
    const t = createTranslator({
      locale: "en",
      messages,
      namespace: "tripReminderEmail.morning_of",
      // Swallow the expected MISSING_MESSAGE so the run stays quiet.
      onError: () => {},
    });
    expect(t("heading")).toContain("tripReminderEmail.morning_of.heading");
  });
});

describe("the cron asks for the prefixed namespace", () => {
  const source = readFileSync(join(__dirname, "route.ts"), "utf8");

  it("uses common.tripReminderEmail", () => {
    expect(source).toContain('"common.tripReminderEmail"');
  });

  it("never asks for the bare tripReminderEmail namespace", () => {
    // Catches a revert to `namespace: \`tripReminderEmail.${slot}\`` or
    // `namespace: "tripReminderEmail"`.
    expect(source).not.toMatch(/namespace:\s*`tripReminderEmail\./);
    expect(source).not.toMatch(/namespace:\s*"tripReminderEmail"/);
  });

  it("still refuses to send an unresolved string", () => {
    // The namespace fix alone is not the safety net — next-intl will happily
    // hand back a key path for any future miss, so the guard must stay.
    expect(source).toContain("assertTranslated");
  });
});
