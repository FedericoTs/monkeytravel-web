import { describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { NextIntlClientProvider, type AbstractIntlMessages } from "next-intl";
import { useEffect, type ReactNode } from "react";
import en from "@/messages/en/common.json";
import es from "@/messages/es/common.json";
import itCommon from "@/messages/it/common.json";
import pt from "@/messages/pt/common.json";
import { MARKETING_CLIENT_NAMESPACES, pickMessages } from "@/lib/i18n/client-messages";
import BottomSheet from "./BottomSheet";
import { ToastProvider, useToast } from "./Toast";

/**
 * The close and dismiss buttons that only show an icon are named for screen
 * readers in the visitor's language. They get the marketing layout's messages,
 * the smaller set: the bottom sheet renders on marketing pages too.
 */
const COMMON = { en, es, it: itCommon, pt } as const;
type Locale = keyof typeof COMMON;

const inLocale = (locale: Locale, ui: ReactNode) =>
  render(
    <NextIntlClientProvider
      locale={locale}
      // common.roles holds string arrays (read with t.raw), which AbstractIntlMessages does not describe.
      messages={pickMessages({ common: COMMON[locale] } as unknown as AbstractIntlMessages, MARKETING_CLIENT_NAMESPACES)}
    >
      {ui}
    </NextIntlClientProvider>,
  );

function ShowToast() {
  const { addToast } = useToast();
  useEffect(() => {
    addToast("Saved", "success", 60_000);
  }, [addToast]);
  return null;
}

describe.each(Object.keys(COMMON) as Locale[])("in %s", (locale) => {
  it("names the bottom sheet's close button", () => {
    inLocale(locale, <BottomSheet isOpen onClose={() => {}} title="Sheet">body</BottomSheet>);
    expect(screen.getByRole("button", { name: COMMON[locale].buttons.close })).toBeTruthy();
  });

  it("names a toast's dismiss button", async () => {
    await act(async () => {
      inLocale(
        locale,
        <ToastProvider>
          <ShowToast />
        </ToastProvider>,
      );
    });
    expect(screen.getByRole("button", { name: COMMON[locale].a11y.dismiss })).toBeTruthy();
  });
});
