/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { CreditedThumb, PhotoCredit } from "./PhotoCredit";
import { withCredit } from "@/lib/images/wikimedia-credit";

/** A Wikimedia photo shows its author and licence, linked to its Commons page; other photos show nothing. */

vi.mock("next-intl", () => ({
  useTranslations: () => (_key: string, v: { author: string; license: string }) => `Photo: ${v.author} · ${v.license}`,
}));

const photo = withCredit("/api/images/wikimedia/0123456789abcdef0123-500.jpg", { author: "A. Photographer", license: "CC BY-SA 4.0", file: "Belém Tower.jpg" });
const page = "https://commons.wikimedia.org/wiki/File:Bel%C3%A9m_Tower.jpg";

describe("PhotoCredit", () => {
  it("credits a Wikimedia photo, without the click reaching the card", () => {
    const onCard = vi.fn();
    const { getByRole } = render(
      <div onClick={onCard}>
        <PhotoCredit src={photo} />
      </div>,
    );
    const link = getByRole("link");
    expect(link.textContent).toBe("Photo: A. Photographer · CC BY-SA 4.0");
    expect(link.getAttribute("href")).toBe(page);
    fireEvent.click(link);
    expect(onCard).not.toHaveBeenCalled();
  });

  it("shows nothing for a Google or stock photo", () => {
    for (const src of ["/api/places/photo?name=places%2FX%2Fphotos%2FY&w=600&h=400", "https://images.pexels.com/photos/1/a.jpeg", undefined]) {
      expect(render(<PhotoCredit src={src} />).container.innerHTML).toBe("");
    }
  });
});

describe("CreditedThumb", () => {
  it("links a small Wikimedia photo to its page, the credit in its title", () => {
    const { getByRole } = render(
      <CreditedThumb src={photo}>
        <span>Belém Tower</span>
      </CreditedThumb>,
    );
    expect(getByRole("link").getAttribute("title")).toBe("Photo: A. Photographer · CC BY-SA 4.0");
    expect(getByRole("link").getAttribute("href")).toBe(page);
  });

  it("leaves any other photo as it is", () => {
    const { container } = render(
      <CreditedThumb src="/api/places/photo?name=x&w=600&h=400">
        <span>x</span>
      </CreditedThumb>,
    );
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toBe("x");
  });
});
