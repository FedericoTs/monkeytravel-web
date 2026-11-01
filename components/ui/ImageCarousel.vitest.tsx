import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import common from "@/messages/en/common.json";
import ImageCarousel from "./ImageCarousel";

const images = [
  { url: "https://example.com/a.jpg", alt: "First" },
  { url: "https://example.com/b.jpg", alt: "Second" },
];

const carousel = (onClose = () => {}) => (
  <NextIntlClientProvider locale="en" messages={{ common }}>
    <ImageCarousel images={images} onClose={onClose} placeName="Belém Tower" />
  </NextIntlClientProvider>
);

// jsdom has no element.scrollTo (the thumbnail strip scrolls to the current image).
const scrollTo = Element.prototype.scrollTo;
beforeAll(() => {
  Element.prototype.scrollTo = () => {};
});
afterAll(() => {
  Element.prototype.scrollTo = scrollTo;
});
afterEach(cleanup);

describe("ImageCarousel", () => {
  it("renders nothing in the server HTML (it is a portal)", () => {
    expect(renderToString(carousel())).toBe("");
  });

  it("opens on its first client render, takes focus and closes on Escape", async () => {
    const onClose = vi.fn();
    render(carousel(onClose));
    const dialog = screen.getByRole("dialog", { name: "Belém Tower" });
    expect(dialog.parentElement).toBe(document.body);

    await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    expect(dialog.contains(document.activeElement)).toBe(true);

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("steps through the photos with the arrow keys and stops at either end", () => {
    const three = [...images, { url: "https://example.com/c.jpg", alt: "Third" }];
    render(
      <NextIntlClientProvider locale="en" messages={{ common }}>
        <ImageCarousel images={three} onClose={() => {}} />
      </NextIntlClientProvider>
    );
    const press = (key: string) => act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { key })));

    press("ArrowRight");
    press("ArrowRight");
    press("ArrowRight");
    expect(screen.getByAltText("Third")).toBeTruthy();

    press("ArrowLeft");
    expect(screen.getByAltText("Second")).toBeTruthy();
    press("ArrowLeft");
    press("ArrowLeft");
    expect(screen.getByAltText("First")).toBeTruthy();
  });
});
