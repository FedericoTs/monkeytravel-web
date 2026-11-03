import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enCommon from "@/messages/en/common.json";
import itCommon from "@/messages/it/common.json";
import UnverifiedNote from "./UnverifiedNote";

const note = (unverified: boolean | undefined, locale = "en", common: object = enCommon) =>
  render(
    <NextIntlClientProvider locale={locale} messages={{ common }}>
      <UnverifiedNote activity={{ unverified }} />
    </NextIntlClientProvider>
  ).container.textContent;

afterEach(cleanup);

describe("UnverifiedNote", () => {
  it("tells the traveller to check a place Google Maps doesn't have", () => {
    expect(note(true)).toBe(enCommon.activity.unverified);
    expect(note(true, "it", itCommon)).toBe(itCommon.activity.unverified);
  });

  it("says nothing about a place that was found, or never checked", () => {
    expect(note(false)).toBe("");
    expect(note(undefined)).toBe("");
  });
});
