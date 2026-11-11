import { describe, expect, it } from "vitest";
import { render } from "@react-email/render";
import { EmailLayout } from "./_layout";

/**
 * Every email says which language it is written in, so a screen reader reads an
 * Italian email with Italian sounds and a mail app offers translation the right way.
 */
describe("the email's language", () => {
  it("is the one it is written in", async () => {
    for (const locale of ["en", "es", "it", "pt"] as const) {
      const html = await render(EmailLayout({ preview: "Hello", locale, children: null }));
      expect(html, locale).toMatch(new RegExp(`<html[^>]* lang="${locale}"`));
    }
  });

  it("is English when none is given", async () => {
    const html = await render(EmailLayout({ preview: "Hello", children: null }));
    expect(html).toMatch(/<html[^>]* lang="en"/);
  });
});
