/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import { render } from "@react-email/render";
import FinishTripEmail, { finishTripEmailText, finishTripSubject, type FinishTripEmailProps } from "./FinishTrip";
import { escapeHtmlText, verifyRenderedEmail, blockingDefects } from "../verify-render";

const props: FinishTripEmailProps = {
  heading: "Your Lisbon trip is one step away",
  body: "You started planning a trip to Lisbon.",
  ctaLabel: "Plan my trip",
  ctaUrl: "https://monkeytravel.app/trips/new?slot=finish_trip_1d&destination=Lisbon",
  signoff: "The MonkeyTravel Team",
  unsubscribeUrl: "https://monkeytravel.app/unsubscribe?token=abc.def",
  locale: "en",
};

describe("FinishTripEmail", () => {
  it("renders one CTA to the planner, the team sign-off and the one-click unsubscribe", async () => {
    const html = await render(FinishTripEmail(props));
    expect(html).toContain(`href="${escapeHtmlText(props.ctaUrl)}"`);
    expect(html).toContain("The MonkeyTravel Team");
    expect(html).toContain(escapeHtmlText(props.unsubscribeUrl!));
    expect(finishTripSubject(props)).toBe(props.heading);
    const defects = verifyRenderedEmail({
      subject: finishTripSubject(props),
      html,
      destination: "Lisbon",
      ctaUrl: props.ctaUrl,
      ownStrings: [],
    });
    expect(blockingDefects(defects)).toEqual([]);
  });

  it("falls back to the preferences page without an unsubscribe token", async () => {
    const html = await render(FinishTripEmail({ ...props, unsubscribeUrl: undefined }));
    expect(html).toContain("/profile/notifications");
  });

  it("has a plain-text version with the link and the sign-off", () => {
    const text = finishTripEmailText({ ...props, locale: "it" });
    expect(text).toContain(`Plan my trip: ${props.ctaUrl}`);
    expect(text).toContain("— The MonkeyTravel Team");
    expect(text).toContain("Gestisci le preferenze: https://monkeytravel.app/unsubscribe?token=abc.def");
  });
});
