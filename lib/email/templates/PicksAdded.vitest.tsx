/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import { render } from "@react-email/render";
import PicksAddedEmail, { picksAddedEmailText, picksAddedSubject, type PicksAddedEmailProps } from "./PicksAdded";
import { picksAddedCopy, type EmailLocale } from "../copy";
import { escapeHtmlText, verifyRenderedEmail, blockingDefects } from "../verify-render";

/**
 * The email a trip's owner gets when someone going adds what they don't want to miss: who, every pick, and one
 * link that opens the trip on the card that adds them.
 */

const LOCALES: EmailLocale[] = ["en", "es", "it", "pt"];
const props: PicksAddedEmailProps = {
  guestName: "Bo",
  picks: ["Belém Tower", "Time Out Market"],
  tripTitle: "Lisbon in May",
  tripDestination: "Lisbon",
  tripUrl: "https://monkeytravel.app/trips/trip-1?open=who",
  unsubscribeUrl: "https://monkeytravel.app/unsubscribe?token=abc.def",
  locale: "en",
};
const has = (html: string, text: string) => html.includes(escapeHtmlText(text));

describe("PicksAddedEmail", () => {
  it("says who, lists every pick, links the trip's card and stops by one click", async () => {
    const html = await render(PicksAddedEmail(props));
    expect(has(html, "Bo doesn't want to miss")).toBe(true);
    // Each its own line in the box (the preview text, hidden, carries them all too).
    for (const pick of props.picks) expect(html).toContain(`${escapeHtmlText(pick)}</p>`);
    expect(html).toContain(`href="${escapeHtmlText(props.tripUrl)}"`);
    expect(html).toContain(escapeHtmlText(props.unsubscribeUrl!));
    expect(has(html, `"${props.tripTitle}"`)).toBe(true);
    const defects = verifyRenderedEmail({
      subject: picksAddedSubject(props.tripDestination, "en"),
      html,
      destination: "Lisbon",
      ctaUrl: props.tripUrl,
      ownStrings: [],
    });
    expect(blockingDefects(defects)).toEqual([]);
  });

  it("names nobody when the person going gave no name", async () => {
    const html = await render(PicksAddedEmail({ ...props, guestName: null }));
    expect(has(html, "Someone going doesn't want to miss")).toBe(true);
    expect(html).not.toContain("null");
  });

  it("falls back to the destination when the trip has no title, and to the preferences page", async () => {
    const html = await render(PicksAddedEmail({ ...props, tripTitle: "", unsubscribeUrl: undefined }));
    expect(has(html, "Lisbon")).toBe(true);
    expect(html).toContain("/profile/notifications");
  });

  it.each(LOCALES)("in %s: the subject names the destination, never the person going", (locale) => {
    const subject = picksAddedSubject("Lisbon", locale);
    expect(subject).toContain("Lisbon");
    expect(subject).not.toContain("Bo");
    expect(picksAddedCopy[locale].heading("Bo")).toContain("Bo");
  });

  it.each(LOCALES)("in %s: the plain text has the heading, every pick and the link", (locale) => {
    const text = picksAddedEmailText({ ...props, locale });
    const t = picksAddedCopy[locale];
    expect(text).toContain(t.heading("Bo"));
    for (const pick of props.picks) expect(text).toContain(`- ${pick}`);
    expect(text).toContain(`${t.cta}: ${props.tripUrl}`);
    expect(text).toContain(t.howTo);
  });

  it.each(LOCALES)("in %s: rendered in that language", async (locale) => {
    const html = await render(PicksAddedEmail({ ...props, locale }));
    const t = picksAddedCopy[locale];
    expect(has(html, t.heading("Bo"))).toBe(true);
    expect(has(html, t.howTo)).toBe(true);
    expect(has(html, t.cta)).toBe(true);
  });
});
