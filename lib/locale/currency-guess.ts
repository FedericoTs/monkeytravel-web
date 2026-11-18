import { LOCALE_CURRENCY_MAP, type CurrencyCode } from "./types";

/**
 * The currency a visitor's browser language points to, before they choose one:
 * the whole locale's from the list ("es-AR"), else the region's own currency
 * ("en-IN" rupees, "de-CH" francs), else the language's where it names one
 * country's ("it" euros), else dollars. Only currencies the exchange table
 * converts are guessed from a region or a language.
 */

const EURO_AREA = [
  "AT", "BE", "BG", "CY", "DE", "EE", "ES", "FI", "FR", "GR", "HR", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PT", "SI",
  "SK", "AD", "MC", "SM", "VA", "ME", "XK",
];

const COUNTRY_CURRENCY: Record<string, CurrencyCode> = {
  ...Object.fromEntries(EURO_AREA.map((country) => [country, "EUR"])),
  US: "USD", PR: "USD", EC: "USD", SV: "USD", PA: "USD",
  GB: "GBP", IM: "GBP", JE: "GBP", GG: "GBP",
  CH: "CHF", LI: "CHF",
  IN: "INR", AU: "AUD", CA: "CAD", NZ: "NZD", JP: "JPY", KR: "KRW", CN: "CNY", HK: "HKD", SG: "SGD", MY: "MYR",
  TH: "THB", ID: "IDR", PH: "PHP", IL: "ILS", TR: "TRY", ZA: "ZAR", MX: "MXN", BR: "BRL", PL: "PLN", CZ: "CZK",
  HU: "HUF", RO: "RON", SE: "SEK", NO: "NOK", DK: "DKK", GL: "DKK", FO: "DKK", IS: "ISK",
};

/** A language with no region, where one country's currency is the likely one ("es", "en", "zh" aren't). */
const LANGUAGE_CURRENCY: Record<string, CurrencyCode> = {
  it: "EUR", de: "EUR", fr: "EUR", nl: "EUR", el: "EUR", fi: "EUR", et: "EUR", lv: "EUR", lt: "EUR", sk: "EUR",
  sl: "EUR", hr: "EUR", mt: "EUR", ga: "EUR", bg: "EUR",
  pt: "BRL", pl: "PLN", cs: "CZK", hu: "HUF", ro: "RON", sv: "SEK", da: "DKK", nb: "NOK", nn: "NOK", no: "NOK",
  is: "ISK", ja: "JPY", ko: "KRW", th: "THB", id: "IDR", ms: "MYR", hi: "INR", he: "ILS", iw: "ILS", tr: "TRY",
};

/** The currency for a browser locale such as "en-IN", "de-CH", "zh-Hant-HK" or "it". */
export function currencyForLocale(locale: string): CurrencyCode {
  const exact = LOCALE_CURRENCY_MAP[locale];
  if (exact) return exact;
  const [language = "", ...rest] = locale.split(/[-_]/);
  const region = rest.find((part) => /^[A-Za-z]{2}$/.test(part))?.toUpperCase();
  if (region) return COUNTRY_CURRENCY[region] ?? "USD";
  return LANGUAGE_CURRENCY[language.toLowerCase()] ?? "USD";
}
