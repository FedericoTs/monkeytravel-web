import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import itCommon from "@/messages/it/common.json";
import PlaceGallery from "./PlaceGallery";

/**
 * /api/places labels Google's price level in English ("Free", "Moderate"); the
 * badge showed that word and the tooltip named it to every visitor.
 */
function placeWith(priceLevel: number, priceLevelSymbol: string, priceLevelLabel: string) {
  return {
    placeId: "p1",
    name: "Time Out Market",
    address: "Av. 24 de Julho",
    location: { latitude: 38.7, longitude: -9.1 },
    photos: [{ url: "https://example.com/a.jpg", thumbnailUrl: "https://example.com/a-t.jpg", width: 1200, height: 800, attribution: "Google" }],
    priceLevel,
    priceLevelSymbol,
    priceLevelLabel,
  };
}

async function badgeFor(place: ReturnType<typeof placeWith>) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => place })));
  render(
    <NextIntlClientProvider locale="it" messages={{ common: itCommon }}>
      <PlaceGallery placeName={place.name} placeAddress={place.address} />
    </NextIntlClientProvider>
  );
  return (await screen.findByTitle(/^Verificato: /)) as HTMLElement;
}

afterEach(() => vi.unstubAllGlobals());

describe("PlaceGallery's price badge", () => {
  it("says free in Italian", async () => {
    const badge = await badgeFor(placeWith(0, "Free", "Free"));
    expect(badge.textContent).toBe(itCommon.gallery.priceLevels.free);
    expect(badge.title).toBe(`Verificato: ${itCommon.gallery.priceLevels.free}`);
  });

  it("keeps the symbol and names the level in Italian", async () => {
    const badge = await badgeFor(placeWith(2, "$$", "Moderate"));
    expect(badge.textContent).toBe("$$");
    expect(badge.title).toBe(`Verificato: ${itCommon.gallery.priceLevels.moderate}`);
  });
});
