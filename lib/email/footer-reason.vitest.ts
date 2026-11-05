import { describe, expect, it } from "vitest";
import { render } from "@react-email/render";
import { layoutCopy, type EmailLocale } from "./copy";
import { escapeHtmlText } from "./verify-render";
import AuthActionEmail from "./templates/AuthAction";
import ConfirmSignupEmail from "./templates/ConfirmSignup";
import DeleteAccountCodeEmail from "./templates/DeleteAccountCode";
import InviteEmail from "./templates/Invite";
import TripDayDigestEmail, { tripDayDigestEmailText } from "./templates/TripDayDigest";

/**
 * The footer says why this email arrived. "You have an active account" is only
 * true for someone with one: not a person confirming a signup, signing in with
 * a link for the first time, invited to a trip, or a guest on one.
 */
const LOCALES: EmailLocale[] = ["en", "es", "it", "pt"];
const has = (html: string, text: string) => html.includes(escapeHtmlText(text));

const invite = (locale: EmailLocale) =>
  InviteEmail({
    inviterName: "Ana",
    tripTitle: "Lisbon",
    tripDestination: "Lisbon",
    tripDates: "May 1 - 4",
    role: "editor",
    inviteUrl: "https://monkeytravel.app/invite/x",
    locale,
  });

describe.each(LOCALES)("the footer in %s", (locale) => {
  const copy = layoutCopy[locale];

  it("doesn't claim an account on a signup confirmation", async () => {
    const html = await render(ConfirmSignupEmail({ confirmUrl: "https://monkeytravel.app/c", locale }));
    expect(has(html, copy.footerReason)).toBe(false);
    expect(has(html, copy.footerReasonAddress)).toBe(true);
  });

  it("doesn't claim an account on the link that may create one", async () => {
    const html = await render(AuthActionEmail({ kind: "magiclink", actionUrl: "https://monkeytravel.app/c", locale }));
    expect(has(html, copy.footerReason)).toBe(false);
    expect(has(html, copy.footerReasonAddress)).toBe(true);
  });

  it("says an invitation is why the invited person got this", async () => {
    const html = await render(invite(locale));
    expect(has(html, copy.footerReason)).toBe(false);
    expect(has(html, copy.footerReasonInvited)).toBe(true);
  });

  it("keeps the account wording for someone who has one", async () => {
    const html = await render(DeleteAccountCodeEmail({ code: "123456", locale }));
    expect(has(html, copy.footerReason)).toBe(true);
  });
});

describe("the day digest", () => {
  const props = {
    day: 2,
    destination: "Lisbon",
    heading: "Day 2",
    intro: "Tomorrow",
    ctaLabel: "Open",
    tripUrl: "https://monkeytravel.app/shared/x",
    unsubscribeUrl: "https://monkeytravel.app/unsubscribe?token=x",
    locale: "en" as const,
  };
  const footerCopy = { reason: "You said you are going.", link: "Stop emails about this trip" };

  it("gives a guest their own footer, in the HTML and the plain text", async () => {
    const html = await render(TripDayDigestEmail({ ...props, footerCopy }));
    expect(html).toContain(footerCopy.reason);
    expect(html).toContain(footerCopy.link);
    expect(has(html, layoutCopy.en.footerReason)).toBe(false);

    const text = tripDayDigestEmailText({ ...props, footerCopy });
    expect(text).toContain(footerCopy.reason);
    expect(text).toContain(`${footerCopy.link}: ${props.unsubscribeUrl}`);
    expect(text).not.toContain("Manage preferences");
  });

  it("keeps the account footer for the owner", async () => {
    const html = await render(TripDayDigestEmail(props));
    expect(has(html, layoutCopy.en.footerReason)).toBe(true);
    expect(tripDayDigestEmailText(props)).toContain(`Manage preferences: ${props.unsubscribeUrl}`);
  });
});
