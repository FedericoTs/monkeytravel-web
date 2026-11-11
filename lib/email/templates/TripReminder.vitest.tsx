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

describe("TripReminder one question", () => {
  const needAsk = {
    question: "One question: what do you still need for this trip?",
    answers: [
      { label: "Where to stay", url: "https://monkeytravel.app/feedback/need?t=tok.sig&need=stay&slot=pack_early_14d" },
      { label: "Nothing, I'm all set", url: "https://monkeytravel.app/feedback/need?t=tok.sig&need=set&slot=pack_early_14d" },
    ],
  };

  it("asks under everything else, each answer its own link", async () => {
    const html = await render(TripReminderEmail({ ...base, groupAsk, needAsk }));
    expect(html).toContain(needAsk.question);
    for (const answer of needAsk.answers) expect(html).toContain(href(answer.url));
    expect(html).toContain("Nothing, I&#x27;m all set");
    expect(html.indexOf(href(groupAsk.url))).toBeLessThan(html.indexOf(needAsk.question));
  });

  it("is absent unless the cron passes it", async () => {
    expect(await render(TripReminderEmail(base))).not.toContain("/feedback/need");
    expect(tripReminderEmailText(base)).not.toContain("/feedback/need");
  });

  it("is in the plain-text version too", () => {
    const text = tripReminderEmailText({ ...base, needAsk });
    expect(text).toContain(needAsk.question);
    for (const answer of needAsk.answers) expect(text).toContain(`${answer.label}: ${answer.url}`);
  });

  it("still passes the send-time check", async () => {
    const html = await render(TripReminderEmail({ ...base, needAsk }));
    const defects = blockingDefects(
      verifyRenderedEmail({ subject: "Two weeks to go — Lisbon", html, destination: "Lisbon", ctaUrl: base.tripUrl, contextBlocks: [], ownStrings: [] })
    );
    expect(defects).toEqual([]);
  });
});

describe("TripReminder preview line", () => {
  it("names the destination once when the heading already does", async () => {
    const html = await render(TripReminderEmail({ ...base, slot: "weather_3d", heading: "Three days to Lisbon" }));
    expect(html).toContain("Three days to Lisbon");
    expect(html).not.toContain("Three days to Lisbon — Lisbon");
  });

  it("adds the destination when the heading lacks it", async () => {
    expect(await render(TripReminderEmail(base))).toContain("Two weeks to go — Lisbon");
  });
});
