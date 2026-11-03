import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider, type AbstractIntlMessages } from "next-intl";
import enCommon from "@/messages/en/common.json";
import esCommon from "@/messages/es/common.json";
import itCommon from "@/messages/it/common.json";
import ptCommon from "@/messages/pt/common.json";
import enTrips from "@/messages/en/trips.json";
import esTrips from "@/messages/es/trips.json";
import itTrips from "@/messages/it/trips.json";
import ptTrips from "@/messages/pt/trips.json";
import { APP_CLIENT_NAMESPACES, pickMessages } from "@/lib/i18n/client-messages";
import { SaveSuccessToast } from "./TripNotices";

/**
 * The save toast in the planner's language, with the app's messages: its
 * icon-only dismiss button is named for screen readers.
 */
const MESSAGES = {
  en: { common: enCommon, trips: enTrips },
  es: { common: esCommon, trips: esTrips },
  it: { common: itCommon, trips: itTrips },
  pt: { common: ptCommon, trips: ptTrips },
} as const;
type Locale = keyof typeof MESSAGES;

afterEach(cleanup);

describe.each(Object.keys(MESSAGES) as Locale[])("in %s", (locale) => {
  it("names the save toast's dismiss button", () => {
    render(
      <NextIntlClientProvider
        locale={locale}
        // common.roles holds string arrays (read with t.raw), which AbstractIntlMessages does not describe.
        messages={pickMessages(MESSAGES[locale] as unknown as AbstractIntlMessages, APP_CLIENT_NAMESPACES)}
      >
        <SaveSuccessToast onDismiss={() => {}} />
      </NextIntlClientProvider>
    );
    expect(screen.getByRole("button", { name: MESSAGES[locale].common.a11y.dismiss })).toBeTruthy();
  });
});
