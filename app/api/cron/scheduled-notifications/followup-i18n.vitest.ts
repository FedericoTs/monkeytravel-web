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
        // because which of the two carries the placeholder varies by slot.
        const rendered = {
          heading: t("heading", { destination: "Lisbon" }),
          body: t("body", { destination: "Lisbon" }),
          cta: t("cta"),
        };

        for (const [key, value] of Object.entries(rendered)) {
          expect(value, `${locale}/${slot} ${key}`).not.toContain(
            "tripFollowupEmail."
          );
          expect(value, `${locale}/${slot} ${key} left braces`).not.toContain(
            "{destination}"
          );
          if (raw[slot][key]?.includes("{destination}")) {
            expect(value, `${locale}/${slot} ${key} substitution`).toContain(
              "Lisbon"
            );
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

describe("consent: these are marketing, not transactional", () => {
  const send = readFileSync(
    join(ROOT, "lib", "email", "send.ts"),
    "utf8"
  );

  it("gates trip_followup on marketingNotifications", () => {
    // The whole ethical distinction of Loop 2 in one assertion. Someone who
    // opted into reminders for a trip they booked has NOT agreed to be
    // marketed to after it ends.
    expect(send).toMatch(/trip_followup:\s*"marketingNotifications"/);
  });

  it("never gates trip_followup on tripReminders", () => {
    expect(send).not.toMatch(/trip_followup:\s*"tripReminders"/);
  });

  it("keeps the pre-trip cascade on tripReminders", () => {
    // Guards the reverse mistake — widening the reminder gate to marketing
    // would silently stop honouring a reminder opt-out.
    expect(send).toMatch(/trip_reminder:\s*"tripReminders"/);
  });

  it("mints a one-click unsubscribe under the marketing key", () => {
    // RFC 8058 List-Unsubscribe is built from UNSUB_KEY. A marketing send
    // whose unsubscribe writes the WRONG preference is worse than none: the
    // user believes they opted out and keeps receiving mail.
    const unsubBlock = send.slice(send.indexOf("const UNSUB_KEY"));
    expect(unsubBlock).toMatch(/trip_followup:\s*"marketingNotifications"/);
  });
});

describe("the cron wires the followup family correctly", () => {
  const source = readFileSync(join(__dirname, "route.ts"), "utf8");

  it("uses the prefixed common.tripFollowupEmail namespace", () => {
    expect(source).toContain('"common.tripFollowupEmail"');
  });

  it("never asks for the bare tripFollowupEmail namespace", () => {
    expect(source).not.toMatch(/namespace:\s*`tripFollowupEmail\./);
    expect(source).not.toMatch(/namespace:\s*"tripFollowupEmail"/);
  });

  it("suppresses the sequence once the user plans another trip", () => {
    // The exit condition. Without it, "Thinking about the next one?" lands on
    // someone who booked it last week.
    expect(source).toContain("user_has_new_trip");
  });

  it("still refuses to send an unresolved string", () => {
    expect(source).toContain("assertTranslated");
    expect(source).toContain("tripFollowupEmail.");
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
