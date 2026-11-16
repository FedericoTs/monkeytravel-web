/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { TravelAdvisory } from "@/lib/advisories/fcdo";
import TravelAdvisoryBanner from "./TravelAdvisoryBanner";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key, useLocale: () => "en" }));
const opened = vi.hoisted(() => vi.fn());
vi.mock("@/lib/native/external-link", () => ({ openExternal: opened }));

const advisory = (over: Partial<TravelAdvisory> = {}): TravelAdvisory => ({
  source: "fcdo",
  sourceCountry: "GB",
  countryName: "Atlantis",
  level: "high",
  advice: "all_parts",
  summary: "Read the advice before you go.",
  url: "https://example.com/advice",
  updatedAt: "2026-10-01T00:00:00Z",
  ...over,
});

afterEach(() => {
  cleanup();
  opened.mockReset();
});

describe("the UK's travel advice card", () => {
  it.each(["all_whole", "essential_whole", "all_parts", "essential_parts", "other"] as const)(
    "heads %s advice with the UK's own terms",
    (advice) => {
      render(<TravelAdvisoryBanner advisory={advisory({ advice })} />);
      expect(screen.getByRole("heading").textContent).toBe(`advice.${advice}`);
      expect(screen.getByText("Read the advice before you go.")).toBeTruthy();
    }
  );

  it("heads advice without the UK's terms as general advice", () => {
    render(<TravelAdvisoryBanner advisory={advisory({ advice: null })} />);
    expect(screen.getByRole("heading").textContent).toBe("advice.other");
  });

  it("is an alert only above the plan", () => {
    const { unmount } = render(<TravelAdvisoryBanner advisory={advisory()} />);
    expect(screen.queryByRole("alert")).toBeNull();
    unmount();
    render(<TravelAdvisoryBanner advisory={advisory({ advice: "all_whole", level: "extreme" })} urgent />);
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("opens the full advice", () => {
    render(<TravelAdvisoryBanner advisory={advisory()} />);
    fireEvent.click(screen.getByRole("button", { name: /readFullAdvisory/ }));
    expect(opened).toHaveBeenCalledWith("https://example.com/advice");
  });

  it("shows nothing at the lowest level", () => {
    const { container } = render(<TravelAdvisoryBanner advisory={advisory({ level: "low", advice: null })} />);
    expect(container.innerHTML).toBe("");
  });
});
