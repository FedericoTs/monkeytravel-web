/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { unsubKeyToSettingPatch } from "./unsubscribe";

/**
 * What an unsubscribe actually silences.
 *
 * The mechanism was already sound — RFC 8058 POST one-click, a read-only GET
 * so link prefetchers cannot opt anyone out, idempotent, no-store. The gap
 * was SCOPE: the patch flipped exactly one key, so a recipient who
 * unsubscribed from a pre-trip reminder still had the post-trip marketing
 * sequence armed, and vice versa.
 *
 * To the person receiving them that is one stream of automated email from one
 * product. Getting "Thinking about the next one?" three weeks after pressing
 * unsubscribe reads as being ignored, and the next click is the spam button.
 *
 * The error costs are asymmetric, which is what settles the design:
 *   over-stopping  → a reminder they can restore in one click
 *   under-stopping → a spam complaint, permanent, against the whole domain
 */

const ROOT = join(__dirname, "..", "..");

describe("a lifecycle unsubscribe stops the whole lifecycle stream", () => {
  it("unsubscribing from reminders also stops post-trip marketing", () => {
    const patch = unsubKeyToSettingPatch("tripReminders");
    expect(patch.tripReminders).toBe(false);
    expect(patch.marketingNotifications).toBe(false);
  });

  it("unsubscribing from marketing also stops pre-trip reminders", () => {
    const patch = unsubKeyToSettingPatch("marketingNotifications");
    expect(patch.marketingNotifications).toBe(false);
    expect(patch.tripReminders).toBe(false);
  });

  it("never turns anything ON", () => {
    // A patch is only ever allowed to silence. If any key came back true, an
    // unsubscribe could re-enable something the user had already switched off.
    for (const key of [
      "tripReminders",
      "marketingNotifications",
      "collabVotes",
      "weeklyDigest",
      "all",
    ] as const) {
      for (const v of Object.values(unsubKeyToSettingPatch(key))) {
        expect(v, key).toBe(false);
      }
    }
  });
});

describe("collaboration preferences stay independent", () => {
  it.each(["collabVotes", "collabProposals", "collabComments", "inviteAccepted"] as const)(
    "%s does not silence trip reminders",
    (key) => {
      // Someone actively planning a trip with other people wants these.
      // Silencing them because the user declined marketing would be a worse
      // product, not a safer one.
      const patch = unsubKeyToSettingPatch(key);
      expect(patch[key]).toBe(false);
      expect(patch.tripReminders).toBeUndefined();
      expect(patch.marketingNotifications).toBeUndefined();
    }
  );

  it("a lifecycle unsubscribe does not silence collaboration", () => {
    const patch = unsubKeyToSettingPatch("marketingNotifications");
    expect(patch.collabVotes).toBeUndefined();
    expect(patch.inviteAccepted).toBeUndefined();
  });
});

describe('"all" is the master switch', () => {
  it("sets emailNotifications=false", () => {
    expect(unsubKeyToSettingPatch("all")).toEqual({ emailNotifications: false });
  });
});

describe("the webhook honours the same rules", () => {
  const SRC = readFileSync(
    join(ROOT, "app", "api", "webhooks", "resend", "route.ts"),
    "utf8"
  );

  it("a SPAM COMPLAINT sets the master switch, not just marketing", () => {
    // The user did not ask for less mail, they reported us. Anything
    // narrower keeps emailing someone who called our mail abuse.
    const block = SRC.slice(SRC.indexOf('targetStatus === "complained"'));
    expect(block).toMatch(/optOutMarketing\(admin,\s*recipient,\s*"all"\)/);
  });

  it("a native Resend unsubscribe stops the whole lifecycle stream", () => {
    const block = SRC.slice(SRC.indexOf("contact.updated"));
    expect(block).toMatch(/optOutMarketing\(admin,\s*contactEmail,\s*"lifecycle"\)/);
  });

  it("reuses the shared patch mapping rather than its own", () => {
    // Two routes to "stop emailing me" must not silence different things.
    expect(SRC).toContain("unsubKeyToSettingPatch");
    expect(SRC).not.toMatch(/notification_settings:\s*\{\s*\.\.\.ns,\s*marketingNotifications:\s*false\s*\}/);
  });

  it("short-circuits only when EVERY key in the patch is already off", () => {
    // The old check looked at marketingNotifications alone, so once that was
    // false a later complaint could never reach emailNotifications — the
    // stronger signal swallowed by the weaker one arriving first.
    const fn = SRC.slice(SRC.indexOf("async function optOutMarketing"));
    expect(fn).toContain("Object.entries(patch).every");
  });
});

describe("the send path still gates on these keys", () => {
  const SEND = readFileSync(join(ROOT, "lib", "email", "send.ts"), "utf8");

  it("checks notification_settings before every non-transactional send", () => {
    // The unsubscribe only works because dispatch re-reads consent at SEND
    // time — that is what stops an already-queued row that was enqueued
    // before the user opted out.
    expect(SEND).toContain("NOTIFICATION_SETTING_KEY");
    expect(SEND).toContain("skipped_disabled");
  });

  it("fails closed when the preference read errors", () => {
    // Sending because we could not confirm an opt-out is the one outcome
    // that must never happen.
    const block = SEND.slice(SEND.indexOf("notification_settings_read_failed") - 1200);
    expect(block).toContain("refusing to send");
  });
});
