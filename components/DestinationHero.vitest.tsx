/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import DestinationHero from "./DestinationHero";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: { count?: number }) =>
    values?.count === undefined ? key : `${values.count} activities`,
}));
vi.mock("@/lib/locale", () => ({
  useCurrency: () => ({ convert: (amount: number, currency: string) => ({ formatted: `${amount} ${currency}` }) }),
}));

const hero = (counts: { days?: number; nights?: number; activitiesCount?: number }) =>
  render(<DestinationHero destination="Lisbon, Portugal" title="Lisbon Trip" disableApiCalls {...counts} />).container;

/** The stat chips print counts; a zero must print nothing, not a stray "0". */
describe("DestinationHero counts", () => {
  it("shows a one-day trip as 1D, with no nights", () => {
    const text = hero({ days: 1, nights: 0, activitiesCount: 2 }).textContent;
    expect(text).toContain("1D");
    expect(text).not.toContain("1D0");
    expect(text).toContain("2 activities");
  });

  it("joins days and nights when both are set", () => {
    expect(hero({ days: 3, nights: 2 }).textContent).toContain("3D · 2N");
  });

  it("prints nothing for zero days, nights and activities", () => {
    expect(hero({ days: 0, nights: 0, activitiesCount: 0 }).textContent).not.toMatch(/\d/);
  });
});

/**
 * The budget switches to the visitor's currency after load, so its width
 * changes then. As the last chip in the row, that moves no other chip.
 */
describe("DestinationHero budget chip", () => {
  it("comes last in the stat row", () => {
    const { getByText } = render(
      <DestinationHero
        destination="Lisbon, Portugal"
        title="Lisbon Trip"
        disableApiCalls
        dateRange="May 1 – 3"
        days={3}
        nights={2}
        activitiesCount={4}
        weatherNote="Mild and sunny"
        budget={{ total: 900, currency: "EUR" }}
      />
    );
    const chip = getByText("900 EUR");
    expect(chip.parentElement?.children.length).toBeGreaterThan(3);
    expect(chip.parentElement?.lastElementChild).toBe(chip);
  });
});

/**
 * The cover is the trip page's LCP image. Places covers are stored at 1920px,
 * so the hero offers smaller sizes a phone can pick, and a retry after a
 * failed load must bust the cache on whichever size the browser picked.
 */
describe("DestinationHero cover", () => {
  const PLACES = "/api/places/photo?name=places%2Fabc%2Fphotos%2Fxyz&w=1920&h=1200&t=destination";
  const heroImg = (container: HTMLElement) => container.querySelector<HTMLImageElement>('img[alt="Lisbon, Portugal"]')!;
  const renderWith = (coverImageUrl: string) =>
    render(<DestinationHero destination="Lisbon, Portugal" title="Lisbon Trip" disableApiCalls coverImageUrl={coverImageUrl} />).container;
  const widths = (img: HTMLImageElement) => (img.getAttribute("srcset") ?? "").split(", ").map((c) => c.split(" ")[1]);

  it("lets a phone pick a smaller Places photo, still at high priority", () => {
    const img = heroImg(renderWith(PLACES));
    expect(img.getAttribute("src")).toBe(PLACES);
    expect(widths(img)).toEqual(["828w", "1200w", "1920w"]);
    expect(img.getAttribute("sizes")).toBe("100vw");
    expect(img.getAttribute("fetchpriority")).toBe("high");
  });

  it("keeps other covers to their single src", () => {
    const img = heroImg(renderWith("https://images.pexels.com/photos/1/a.jpeg?w=800&h=600"));
    expect(img.hasAttribute("srcset")).toBe(false);
  });

  it("retries a failed load with the cache-buster on every size", () => {
    const container = renderWith(PLACES);
    fireEvent.error(heroImg(container));
    const retried = heroImg(container);
    expect(retried.getAttribute("src")).toContain("_r=1");
    const candidates = (retried.getAttribute("srcset") ?? "").split(", ");
    expect(candidates).toHaveLength(3);
    for (const c of candidates) expect(c).toContain("_r=1");
  });
});
