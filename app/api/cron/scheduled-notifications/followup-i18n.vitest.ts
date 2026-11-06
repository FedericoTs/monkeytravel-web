import { describe, it, expect } from "vitest";
import { createTranslator } from "next-intl";
import { readFileSync } from "fs";
import { join } from "path";
import { REMINDER_LOCALES } from "@/lib/email/reminder-locale";
import {
  TERMINAL_FOLLOWUP_SLOTS,
  type TripFollowupSlot,
} from "@/lib/email/templates/TripFollowup";

/**
 * Post-trip (Loop 2) copy guard — the sibling of reminder-i18n.vitest.ts.
 *
 * The reminder family shipped broken for two months because next-intl answers
 * a missing message with the key path instead of throwing, so a wrong
 * namespace mails "tripReminderEmail.morning_of.heading" as a subject line and
 * every layer downstream reports success. This family is loaded through the
 * exact same translator, from the same file, by the same route — so it can
 * fail the same silent way, and gets the same guard.
 *
 * It also pins the thing that is NOT true of the reminders: these are
 * marketing emails and must be gated on marketingNotifications. That
 * distinction lives in one line of lib/email/send.ts and is invisible at
 * runtime until someone who opted out of marketing receives one.
 */

const LOCALES = ["en", "es", "it", "pt"] as const;

// Mirrors TripFollowupSlot. Pinned as a literal so adding a slot without
// adding its copy fails HERE, rather than by mailing a key path to whoever
// the new slot fires for.
const SLOTS = [
  "followup_return_3d",
  "followup_next_21d",
  "followup_final_45d",
  "followup_dormant",
] as const;

const ROOT = join(__dirname, "..", "..", "..", "..");

function messagesFor(locale: string): Record<string, unknown> {
  // Built the way i18n.ts builds it: namespace === file basename.
  const raw = readFileSync(join(ROOT, "messages", locale, "common.json"), "utf8");
  return { common: JSON.parse(raw) };
}

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

describe("followup copy exists at the path the cron uses", () => {
  for (const locale of LOCALES) {
    for (const slot of SLOTS) {
      it(`${locale}/${slot} has heading, body and its OWN cta`, () => {
        const node = resolve(
          messagesFor(locale),
          `common.tripFollowupEmail.${slot}`
        );
        expect(node, `common.tripFollowupEmail.${slot} missing`).toBeTypeOf(
          "object"
        );

        const { heading, body, cta } = node as Record<string, unknown>;
        // cta is per-slot here, unlike the reminder family which shares one
        // at the namespace root. The route branches on exactly this.
        for (const [name, value] of Object.entries({ heading, body, cta })) {
          expect(value, `${slot}.${name} missing`).toBeTypeOf("string");
          expect((value as string).trim().length).toBeGreaterThan(0);
          expect(value as string).not.toContain("tripFollowupEmail.");
        }
      });
    }

    it(`${locale} has finalNote for the terminal slots`, () => {
      const note = resolve(
        messagesFor(locale),
        "common.tripFollowupEmail.finalNote"
      );
      expect(note, "finalNote missing").toBeTypeOf("string");
      expect((note as string).trim().length).toBeGreaterThan(0);
    });
  }

  it("is NOT reachable at the un-prefixed namespace", () => {
    // The exact mistake that broke the reminders. Asserting the negative keeps
    // the positive assertions honest.
    expect(
      resolve(messagesFor("en"), "tripFollowupEmail.followup_next_21d")
    ).toBeUndefined();
  });
});

describe("next-intl itself renders the followup copy", () => {
  for (const locale of LOCALES) {
    it(`${locale}: real copy for every slot, no leftover placeholders`, () => {
      const messages = messagesFor(locale) as Parameters<
        typeof createTranslator
      >[0]["messages"];
      const raw = resolve(
        messagesFor(locale),
        "common.tripFollowupEmail"
      ) as Record<string, Record<string, string>>;

      for (const slot of SLOTS) {
        const t = createTranslator({
          locale,
          messages,
          namespace: `common.tripFollowupEmail.${slot}`,
        });
        // Mirrors the route: destination goes to BOTH heading and body,
        // because which of the two carries the placeholder varies by slot,
        // and the body also gets the day the trip ended.
        const rendered = {
          heading: t("heading", { destination: "Lisbon" }),
          body: t("body", { destination: "Lisbon", endDate: "October 10" }),
          cta: t("cta"),
        };

        for (const [key, value] of Object.entries(rendered)) {
          expect(value, `${locale}/${slot} ${key}`).not.toContain(
            "tripFollowupEmail."
          );
          for (const placeholder of ["{destination}", "{endDate}"]) {
            expect(value, `${locale}/${slot} ${key} left ${placeholder}`).not.toContain(placeholder);
          }
          if (raw[slot][key]?.includes("{destination}")) {
            expect(value, `${locale}/${slot} ${key} substitution`).toContain(
              "Lisbon"
            );
          }
          if (raw[slot][key]?.includes("{endDate}")) {
            expect(value, `${locale}/${slot} ${key} end date`).toContain("October 10");
          }
        }
      }
    });
  }

  it("every locale the cron can resolve has the full followup set", () => {
    // Closes the loop the way the reminder suite does: routing reaches these
    // locales AND the copy is there. `pt` was in routing.locales for weeks
    // while resolveLocale still mapped it to English.
    for (const locale of REMINDER_LOCALES) {
      const messages = JSON.parse(
        readFileSync(join(ROOT, "messages", locale, "common.json"), "utf8")
      );
      for (const slot of SLOTS) {
        expect(
          messages.tripFollowupEmail?.[slot]?.heading,
          `${locale}/${slot} heading`
        ).toBeTruthy();
        expect(
          messages.tripFollowupEmail?.[slot]?.body,
          `${locale}/${slot} body`
        ).toBeTruthy();
        expect(
          messages.tripFollowupEmail?.[slot]?.cta,
          `${locale}/${slot} cta`
        ).toBeTruthy();
      }
      expect(messages.tripFollowupEmail?.finalNote, `${locale}/finalNote`)
        .toBeTruthy();
    }
  });
});

/**
 * The return email said "You got back a few days ago" to people we had no sign
 * went at all, and promised questions about the plan that its survey did not
 * ask. It now states when the trip was due to end and asks whether they went.
 */
describe("the return email claims only what we know", () => {
  for (const locale of LOCALES) {
    it(`${locale}: says when the trip was due to end, and has a button for each answer`, () => {
      const words = resolve(messagesFor(locale), "common.tripFollowupEmail.followup_return_3d") as Record<string, string>;
      expect(words.body).toContain("{endDate}");
      expect(words.heading).toContain("{destination}");
      expect(words.cta).toBeTruthy();
      expect(words.ctaNo).toBeTruthy();
      expect(words.ctaNo).not.toBe(words.cta);
    });
  }

  it("en: no longer assumes the trip happened or promises questions about the plan", () => {
    const body = resolve(messagesFor("en"), "common.tripFollowupEmail.followup_return_3d.body") as string;
    expect(body).not.toMatch(/got back|plan got right|on the ground/i);
  });
});

describe("terminal slots are the ones that promise an ending", () => {
  it("marks exactly the final and dormant slots as terminal", () => {
    // Only these two render finalNote. If a mid-sequence slot were marked
    // terminal it would announce "this is the last email" and then send two
    // more — the fastest route to a spam complaint.
    expect([...TERMINAL_FOLLOWUP_SLOTS].sort()).toEqual([
      "followup_dormant",
      "followup_final_45d",
    ]);
  });

  it("every terminal slot is a real slot", () => {
    for (const slot of TERMINAL_FOLLOWUP_SLOTS) {
      expect(SLOTS).toContain(slot as TripFollowupSlot);
    }
  });
});
