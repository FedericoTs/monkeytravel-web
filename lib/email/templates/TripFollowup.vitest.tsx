import { describe, expect, it } from "vitest";
import { render } from "@react-email/render";
import TripFollowupEmail, { tripFollowupEmailText, type TripFollowupEmailProps } from "./TripFollowup";
import { blockingDefects, verifyRenderedEmail } from "../verify-render";

const YES = "https://monkeytravel.app/feedback/went?t=abc.def&answer=yes&slot=followup_return_3d";
const NO = "https://monkeytravel.app/feedback/went?t=abc.def&answer=no&slot=followup_return_3d";

const props: TripFollowupEmailProps = {
  slot: "followup_return_3d",
  destination: "Lisbon",
  heading: "Did you make it to Lisbon?",
  body: "Your trip was planned to end on 3 Nov.",
  ctaLabel: "Yes, I went",
  ctaUrl: YES,
  secondCta: { label: "No, I didn't go", url: NO },
};

const buttons = (html: string) => [...html.matchAll(/<a\s[^>]*href="([^"]*)"[^>]*style="([^"]*)"/g)].filter(([, href]) => href.includes("/feedback/went"));

describe("the email that asks a question", () => {
  it("gives each answer a button, looking the same", async () => {
    const found = buttons(await render(TripFollowupEmail(props)));
    expect(found.map(([, href]) => href.replace(/&amp;/g, "&"))).toEqual([YES, NO]);
    expect(found[0][2]).toBe(found[1][2]);
  });

  it("passes the gate that holds back a broken email", async () => {
    const html = await render(TripFollowupEmail(props));
    const defects = verifyRenderedEmail({ subject: props.heading, html, destination: "Lisbon", ctaUrl: YES, ownStrings: [] });
    expect(blockingDefects(defects)).toEqual([]);
  });

  it("names both answers and their links in the plain text", () => {
    const text = tripFollowupEmailText(props);
    expect(text).toContain(`Yes, I went: ${YES}`);
    expect(text).toContain(`No, I didn't go: ${NO}`);
  });

  it("has one button and one link when there's one answer", async () => {
    const one = { ...props, secondCta: undefined };
    expect(buttons(await render(TripFollowupEmail(one)))).toHaveLength(1);
    expect(tripFollowupEmailText(one)).not.toContain(NO);
  });
});
