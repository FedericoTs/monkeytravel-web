import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en/trips.json";
import esMessages from "@/messages/es/trips.json";
import itMessages from "@/messages/it/trips.json";
import ptMessages from "@/messages/pt/trips.json";
import { PlacesCheckedNote } from "./PlacesCheckedNote";

const NOTE = { checkedAt: "2026-11-06T23:30:00.000Z", checked: 8, changed: 0 };
const MESSAGES = { en: enMessages, es: esMessages, it: itMessages, pt: ptMessages };

const show = (note: Parameters<typeof PlacesCheckedNote>[0]["note"], locale: keyof typeof MESSAGES = "en") =>
  render(
    <NextIntlClientProvider locale={locale} messages={{ trips: MESSAGES[locale] }}>
      <PlacesCheckedNote note={note} className="mb-4" />
    </NextIntlClientProvider>,
  );

afterEach(cleanup);

describe("PlacesCheckedNote", () => {
  it("says how many places were looked up, and when", () => {
    const { container } = show(NOTE);
    expect(container.textContent).toBe("8 places to eat checked on Google Maps, Nov 6, 2026.");
    expect(container.querySelector("p")?.className).toContain("mb-4");
  });

  it("says one place in the singular", () => {
    const { container } = show({ ...NOTE, checked: 1 });
    expect(container.textContent).toContain("1 place to eat checked");
  });

  it("says what changed when something did", () => {
    expect(show({ ...NOTE, changed: 1 }).container.textContent).toContain("We changed 1 that wasn't open.");
    cleanup();
    expect(show({ ...NOTE, changed: 2 }).container.textContent).toContain("We changed 2 that weren't open.");
  });

  it("shows the same day whatever the viewer's clock says", () => {
    const { container } = show({ ...NOTE, checkedAt: "2026-11-06T00:30:00.000Z" });
    expect(container.textContent).toContain("Nov 6, 2026");
  });

  it("says nothing without a check", () => {
    expect(show(null).container.textContent).toBe("");
  });

  it.each([
    ["es", "8 lugares para comer comprobados en Google Maps", "Cambiamos 2 que no estaban abiertos."],
    ["it", "8 posti dove mangiare controllati su Google Maps", "Ne abbiamo cambiati 2 che non erano aperti."],
    ["pt", "8 lugares para comer verificados no Google Maps", "Trocamos 2 que não estavam abertos."],
  ] as const)("says it in %s", (locale, checked, changed) => {
    const { container } = show({ ...NOTE, changed: 2 }, locale);
    expect(container.textContent).toContain(checked);
    expect(container.textContent).toContain(changed);
  });
});
