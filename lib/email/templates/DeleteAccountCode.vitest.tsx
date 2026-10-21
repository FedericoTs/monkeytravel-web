import { describe, it, expect } from "vitest";
import { render } from "@react-email/render";
import DeleteAccountCodeEmail, {
  deleteAccountCodeEmailText,
  deleteAccountCodeSubject,
} from "./DeleteAccountCode";
import { deleteAccountCodeCopy, type EmailLocale } from "../copy";

const CODE = "482915";
const LOCALES: EmailLocale[] = ["en", "es", "it", "pt"];

describe("DeleteAccountCodeEmail", () => {
  for (const locale of LOCALES) {
    it(`${locale}: carries the code and says what it is for`, async () => {
      const html = (await render(DeleteAccountCodeEmail({ code: CODE, locale }))).replace(/&#x27;/g, "'");
      const text = deleteAccountCodeEmailText({ code: CODE, locale });
      for (const body of [html, text]) {
        expect(body).toContain(CODE);
        expect(body).toContain(deleteAccountCodeCopy[locale].heading);
      }
      expect(deleteAccountCodeSubject(locale)).toBe(deleteAccountCodeCopy[locale].subject);
    });
  }

  it("has no sign-in link, which would sign the person in instead", async () => {
    const html = await render(DeleteAccountCodeEmail({ code: CODE, locale: "en" }));
    expect(html).not.toContain("/auth/v1/verify");
    expect(html).not.toContain("magiclink");
  });
});
