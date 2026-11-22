import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enCommon from "@/messages/en/common.json";
import itCommon from "@/messages/it/common.json";

const openExternal = vi.hoisted(() => vi.fn());
vi.mock("@/lib/native/external-link", () => ({ openExternal }));

import ClosingNote from "./ClosingNote";

const SOURCE = "https://www.louvre.fr/en/visit/hours-admission";

afterEach(() => {
  cleanup();
  openExternal.mockClear();
});

const show = (closing: { dates: string[]; source: string } | undefined, locale: "en" | "it" = "en", onCard?: () => void) =>
  render(
    <NextIntlClientProvider locale={locale} messages={{ common: locale === "en" ? enCommon : itCommon }}>
      <div onClick={onCard}>
        <ClosingNote activity={{ closing }} />
      </div>
    </NextIntlClientProvider>
  );

// Plans moved sights off their closing days without a word; the stop now says which of the trip's dates it's shut.
describe("a listed place's closing note", () => {
  it("names the dates it's shut, in the page's language, with a link to the official hours", () => {
    const { container } = show({ dates: ["2026-12-15"], source: SOURCE });
    expect(container.textContent).toBe("Closed Tue, Dec 15 · Official hours");
    cleanup();
    const it = show({ dates: ["2026-12-15"], source: SOURCE }, "it");
    expect(it.container.textContent).toBe("Chiuso mar 15 dic · Orari ufficiali");
  });

  it("opens the official page without opening the card around it", () => {
    const onCard = vi.fn();
    show({ dates: ["2026-12-15", "2026-12-25"], source: SOURCE }, "en", onCard);
    fireEvent.click(screen.getByRole("button", { name: "Official hours" }));
    expect(openExternal).toHaveBeenCalledWith(SOURCE);
    expect(onCard).not.toHaveBeenCalled();
  });

  it("names three dates, and past that two and how many more", () => {
    expect(show({ dates: ["2026-12-15", "2026-12-22", "2026-12-25"], source: SOURCE }).container.textContent).toBe(
      "Closed Tue, Dec 15, Tue, Dec 22, and Fri, Dec 25 · Official hours"
    );
    cleanup();
    expect(show({ dates: ["2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01"], source: SOURCE }).container.textContent).toBe(
      "Closed Mon, Dec 28, Tue, Dec 29, and 3 more days · Official hours"
    );
  });

  it("says nothing without dates, or without an https page to show for them", () => {
    expect(show(undefined).container.textContent).toBe("");
    cleanup();
    expect(show({ dates: [], source: SOURCE }).container.textContent).toBe("");
    cleanup();
    expect(show({ dates: ["2026-12-15"], source: "http://example.com/hours" }).container.textContent).toBe("");
    cleanup();
    expect(show({ dates: ["15 Dec"], source: SOURCE }).container.textContent).toBe("");
  });
});
