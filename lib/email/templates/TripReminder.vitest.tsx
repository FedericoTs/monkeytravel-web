import { describe, it, expect } from "vitest";
import { render } from "@react-email/render";
import TripReminderEmail, { tripReminderEmailText, type TripReminderEmailProps } from "./TripReminder";
import { verifyRenderedEmail, blockingDefects } from "../verify-render";

/**
 * The group ask: on a group trip nobody else has yet, the two early reminders
 * carry a second button for the organiser to add the people coming. Most
 * organisers never reopen the trip after the day they make it, so the email
 * is where the second ask can reach them.
 */

const base: TripReminderEmailProps = {
  slot: "pack_early_14d",
  destination: "Lisbon",
  tripDates: "Nov 12 – Nov 16",
  heading: "Two weeks to go",
  body: "Your Lisbon trip is two weeks away.",
  ctaLabel: "Open your trip",
  tripUrl: "https://monkeytravel.app/trips/t1?slot=pack_early_14d",
};
const groupAsk = {
  text: "Does everyone coming have the plan yet?",
  label: "Add the people coming",
  url: "https://monkeytravel.app/trips/t1?slot=pack_early_14d&share=invite",
};
const href = (url: string) => `href="${url.replace(/&/g, "&amp;")}"`;

describe("TripReminder group ask", () => {
  it("renders the ask and its link under the main button", async () => {
    const html = await render(TripReminderEmail({ ...base, groupAsk }));
    expect(html).toContain(groupAsk.text);
    expect(html).toContain(groupAsk.label);
    expect(html).toContain(href(groupAsk.url));
    expect(html.indexOf(href(base.tripUrl))).toBeLessThan(html.indexOf(href(groupAsk.url)));
  });

  it("is absent unless the cron passes it", async () => {
    const html = await render(TripReminderEmail(base));
    expect(html).not.toContain("share=invite");
    expect(tripReminderEmailText(base)).not.toContain("share=invite");
  });

  it("is in the plain-text version too", () => {
    const text = tripReminderEmailText({ ...base, groupAsk });
    expect(text).toContain(groupAsk.text);
    expect(text).toContain(`${groupAsk.label}: ${groupAsk.url}`);
  });

  it("still passes the send-time check, which follows the main button", async () => {
    const html = await render(TripReminderEmail({ ...base, groupAsk }));
    const defects = blockingDefects(
      verifyRenderedEmail({ subject: "Two weeks to go — Lisbon", html, destination: "Lisbon", ctaUrl: base.tripUrl, contextBlocks: [], ownStrings: [] })
    );
    expect(defects).toEqual([]);
  });
});
