import { describe, it, expect } from "vitest";
import { render } from "@react-email/render";
import ConfirmSignupEmail, { confirmSignupEmailText } from "./ConfirmSignup";
import { authSharedCopy, type EmailLocale } from "../copy";

/**
 * The signup email must carry the six-digit code.
 *
 * This is the template a NEW address receives, because the save modal calls
 * `signInWithOtp({ shouldCreateUser: true })`. Until 2026-09-03 it took no
 * token at all — so the people the funnel loses were precisely the ones who
 * got a link and nothing else. Magic-link sign-ups reach a session 63.0% of
 * the time against Google's 99.0% (n=142, p=1.8e-9).
 *
 * The code is optional in the props because the dashboard-template rendering
 * path has no token, which makes it quietly droppable — hence these tests.
 */

const CODE = "482915";
const LOCALES: EmailLocale[] = ["en", "es", "it", "pt"];

describe("ConfirmSignupEmail", () => {
  it("renders the code when there is one", async () => {
    const html = await render(
      ConfirmSignupEmail({ confirmUrl: "https://monkeytravel.app/auth/callback?x=1", token: CODE, locale: "en" })
    );
    expect(html).toContain(CODE);
  });

  it("labels the code so it is not mistaken for an order number", async () => {
    const html = await render(
      ConfirmSignupEmail({ confirmUrl: "https://monkeytravel.app/x", token: CODE, locale: "en" })
    );
    expect(html).toContain(authSharedCopy.en.codeLabel);
  });

  it("still renders without a code", async () => {
    // The dashboard-template path passes no token; it must not break, and it
    // must not print an empty code box either.
    const html = await render(ConfirmSignupEmail({ confirmUrl: "{{ .ConfirmationURL }}", locale: "en" }));
    expect(html).toContain("{{ .ConfirmationURL }}");
    expect(html).not.toContain(authSharedCopy.en.codeLabel);
  });

  it("keeps the link as well as the code", async () => {
    // The code is an addition, not a replacement — someone reading on the
    // device they signed up on should still just tap.
    const url = "https://monkeytravel.app/auth/callback?token_hash=abc&type=signup";
    const html = await render(ConfirmSignupEmail({ confirmUrl: url, token: CODE, locale: "en" }));
    expect(html).toContain("token_hash=abc");
    expect(html).toContain(CODE);
  });

  it("carries the code in every shipped locale", async () => {
    for (const locale of LOCALES) {
      const html = await render(ConfirmSignupEmail({ confirmUrl: "https://x/y", token: CODE, locale }));
      expect(html, `${locale} html`).toContain(CODE);
      expect(html, `${locale} label`).toContain(authSharedCopy[locale].codeLabel);
    }
  });

  it("puts the code in the plain-text part too", async () => {
    // Plain text is what a text-only client and most screen readers get.
    for (const locale of LOCALES) {
      const text = confirmSignupEmailText({ confirmUrl: "https://x/y", token: CODE, locale });
      expect(text, `${locale}`).toContain(CODE);
      expect(text, `${locale} label`).toContain(authSharedCopy[locale].codeLabel);
    }
  });

  it("omits the code line from plain text when there is no code", () => {
    const text = confirmSignupEmailText({ confirmUrl: "https://x/y", locale: "en" });
    expect(text).not.toContain(authSharedCopy.en.codeLabel);
  });
});
