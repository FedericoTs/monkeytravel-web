import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import type { GeneratedItinerary } from "@/types";

const push = vi.fn();
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en",
}));
vi.mock("@/lib/i18n/routing", () => ({
  useRouter: () => ({ push }),
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/posthog", () => ({ capture: vi.fn() }));
vi.mock("next/dynamic", () => ({
  default: () =>
    function ExportMenu() {
      return <div data-testid="export-menu" />;
    },
}));

import ResultActionBars from "./ResultActionBars";

type Props = ComponentProps<typeof ResultActionBars>;

const itinerary = {
  destination: { name: "Lisbon", country: "Portugal", description: "Lisbon in spring" },
  days: [
    { day_number: 1, activities: [] },
    { day_number: 2, activities: [] },
  ],
  trip_summary: { total_estimated_cost: 900, currency: "EUR" },
} as unknown as GeneratedItinerary;

const shared: Record<string, unknown>[] = [];
const ShareButton = ((p: Record<string, unknown>) => {
  shared.push(p);
  return <button type="button">share</button>;
}) as unknown as Props["ShareButton"];
const RegenerateButton = (({ onRegenerate, variant }: { onRegenerate: () => void; variant?: string }) => (
  <button type="button" onClick={onRegenerate}>
    regenerate {variant}
  </button>
)) as unknown as Props["RegenerateButton"];

const on = {
  save: vi.fn(),
  startOver: vi.fn(),
  regenerate: vi.fn(),
  shared: vi.fn(),
  keep: vi.fn(),
};
const share: Props["share"] = {
  trip: {
    title: "Lisbon",
    description: "Lisbon in spring",
    destination: "Lisbon, Portugal",
    startDate: "2027-05-10",
    endDate: "2027-05-11",
    itinerary: itinerary.days,
    locale: "en",
  },
  mode: "share",
  existingShareUrl: null,
  onShared: on.shared,
  onKeep: on.keep,
};
const props = (over: Partial<Props> = {}): Props => ({
  generatedItinerary: itinerary,
  totalCost: "€900",
  tripTitle: "Lisbon",
  startDate: "2027-05-10",
  endDate: "2027-05-11",
  isAuthenticated: false,
  savedTripId: null,
  autoSave: null,
  autoSaving: false,
  isUnsaved: true,
  keptPlan: null,
  saving: false,
  onSave: on.save,
  onStartOver: on.startOver,
  requestRegenerate: on.regenerate,
  regenerating: false,
  share,
  ShareButton,
  RegenerateButton,
  ...over,
});

/** The sticky header and the phone bar, as their own queries. */
function bars(over: Partial<Props> = {}) {
  const { container } = render(<ResultActionBars {...props(over)} />);
  return {
    header: within(container.querySelector<HTMLElement>("div.sticky")!),
    bar: within(container.querySelector<HTMLElement>("div.fixed")!),
  };
}
const crew = "wizard.result.shareForVotes";
/** Opens what the phone bar keeps behind More. */
const openMore = (bar: ReturnType<typeof bars>["bar"]) => fireEvent.click(bar.getByRole("button", { name: "more" }));

beforeEach(() => {
  shared.length = 0;
  [push, ...Object.values(on)].forEach((fn) => fn.mockClear());
});
afterEach(cleanup);

describe("ResultActionBars", () => {
  it("lets a signed-out planner share without an account, and says the plan is not saved", () => {
    const { header, bar } = bars();
    expect(header.queryByRole("button", { name: crew })).toBeNull();
    expect(bar.queryByRole("button", { name: crew })).toBeNull();
    expect(header.getByRole("button", { name: "share" })).toBeTruthy();
    expect(header.getByText("wizard.result.notSavedPill")).toBeTruthy();
    expect(bar.getByText("wizard.result.notSavedPill")).toBeTruthy();
    expect(header.getByText("wizard.result.saveHeaderNudge")).toBeTruthy();
    // On a phone Share is in sight, above the bar's row: not behind More, and not twice.
    expect(bar.getByRole("button", { name: "share" })).toBeTruthy();
    openMore(bar);
    expect(bar.getAllByRole("button", { name: "share" })).toHaveLength(1);
    expect(bar.getByText("wizard.result.mobileSaveNudge")).toBeTruthy();
    // Both carry the page's share (the bar's with its own spacing).
    expect(shared.every((given) => JSON.stringify({ ...given, className: undefined }) === JSON.stringify(share))).toBe(true);
    expect(header.getByText("€900")).toBeTruthy();

    fireEvent.click(header.getByRole("button", { name: "wizard.result.saveTrip" }));
    expect(on.save).toHaveBeenCalledTimes(1);
  });

  it("shows no total chip when the plan prices nothing", () => {
    const { header } = bars({ totalCost: "" });
    expect(header.queryByText("€900")).toBeNull();
    // The days chip stays, alone, with no empty chip beside it.
    const days = header.getByText("wizard.result.days");
    expect(days.parentElement?.children).toHaveLength(1);
  });

  it("puts a kept plan's link where the not-saved pill was, and says it is kept", () => {
    const { header, bar } = bars({ keptPlan: { token: "T".repeat(22), expiresAt: "2099-01-01T00:00:00.000Z" } });
    expect(header.getByRole("button", { name: "wizard.kept.copyLink" })).toBeTruthy();
    expect(bar.getByRole("button", { name: "wizard.kept.copyLink" })).toBeTruthy();
    expect(header.queryByText("wizard.result.notSavedPill")).toBeNull();
    expect(header.getByText("wizard.kept.headerNudge")).toBeTruthy();
    openMore(bar);
    expect(bar.getByText("wizard.kept.mobileNudge")).toBeTruthy();
  });

  it("signed in, asks the crew by saving first, then by opening the saved trip's invite", () => {
    let { header, bar } = bars({ isAuthenticated: true });
    expect(header.queryByRole("button", { name: "share" })).toBeNull();
    fireEvent.click(header.getByRole("button", { name: crew }));
    fireEvent.click(bar.getByRole("button", { name: crew }));
    expect(on.save).toHaveBeenCalledTimes(2);
    expect(push).not.toHaveBeenCalled();
    cleanup();

    ({ header, bar } = bars({ isAuthenticated: true, savedTripId: "t1", isUnsaved: false }));
    fireEvent.click(header.getByRole("button", { name: crew }));
    expect(push).toHaveBeenLastCalledWith("/trips/t1?share=invite");
    openMore(bar);
    expect(bar.queryByRole("button", { name: crew })).toBeNull();
    expect(header.getByTestId("export-menu")).toBeTruthy();
    expect(header.queryByText("wizard.result.saveHeaderNudge")).toBeNull();
    cleanup();

    ({ header, bar } = bars({
      isAuthenticated: true,
      autoSave: { savedTripId: "t2", status: "saved", retry: vi.fn() },
      autoSaving: true,
      isUnsaved: false,
    }));
    fireEvent.click(header.getByRole("button", { name: crew }));
    expect(push).toHaveBeenLastCalledWith("/trips/t2?share=invite");
    openMore(bar);
    expect(bar.queryByRole("button", { name: crew })).toBeNull();
    expect(header.queryByTestId("export-menu")).toBeNull();
    expect(header.getByRole("link", { name: "result.savedViewTrip" }).getAttribute("href")).toBe("/trips/t2");
  });

  it("starts over and regenerates from both bars", () => {
    const { header, bar } = bars();
    fireEvent.click(header.getByRole("button", { name: "wizard.result.startOver" }));
    openMore(bar);
    fireEvent.click(bar.getByRole("button", { name: "wizard.result.startOver" }));
    expect(on.startOver).toHaveBeenCalledTimes(2);
    fireEvent.click(header.getByRole("button", { name: "regenerate compact" }));
    openMore(bar);
    fireEvent.click(bar.getByRole("button", { name: "regenerate default" }));
    expect(on.regenerate).toHaveBeenCalledTimes(2);
  });

  describe("the phone bar", () => {
    const buttonNames = (bar: ReturnType<typeof bars>["bar"]) => bar.getAllByRole("button").map((b) => b.textContent);

    it("shows Share above one row of More, the plan's state and Save, with the rest behind More", () => {
      const { bar } = bars();
      expect(buttonNames(bar)).toEqual(["share", "more", "wizard.result.saveTrip"]);
      expect(bar.getByText("wizard.result.notSavedPill")).toBeTruthy();
      expect(bar.queryByText("wizard.result.mobileSaveNudge")).toBeNull();
    });

    it("gives a kept plan's link the same place in that row", () => {
      const { bar } = bars({ keptPlan: { token: "T".repeat(22), expiresAt: "2099-01-01T00:00:00.000Z" } });
      expect(buttonNames(bar)).toEqual(["share", "more", "wizard.kept.copyLink", "wizard.result.saveTrip"]);
    });

    it("shows a signed-in planner the crew ask in Share's place", () => {
      const { bar } = bars({ isAuthenticated: true });
      expect(buttonNames(bar)).toEqual([crew, "more", "wizard.result.saveTrip"]);
    });

    it("drops the share row once the trip is saved, or while it saves itself", () => {
      expect(buttonNames(bars({ isAuthenticated: true, savedTripId: "t1", isUnsaved: false }).bar)).not.toContain(crew);
      cleanup();
      const autoSave = { savedTripId: "t2", status: "saved" as const, retry: vi.fn() };
      expect(buttonNames(bars({ isAuthenticated: true, autoSave, autoSaving: true, isUnsaved: false }).bar)).not.toContain(crew);
      cleanup();
      expect(buttonNames(bars({ savedTripId: "t3", isUnsaved: false }).bar)).not.toContain("share");
    });

    it("says More is open, and keeps Save in reach while it is", () => {
      const { bar } = bars();
      const more = bar.getByRole("button", { name: "more" });
      expect(more.getAttribute("aria-expanded")).toBe("false");
      fireEvent.click(more);
      expect(more.getAttribute("aria-expanded")).toBe("true");
      expect(document.getElementById(more.getAttribute("aria-controls")!)).toBeTruthy();
      expect(bar.getByRole("button", { name: "wizard.result.saveTrip" })).toBeTruthy();
    });

    it("closes on More again, on Escape, on a tap outside, and after choosing", () => {
      const { bar } = bars();
      const closed = () => bar.queryByRole("button", { name: "wizard.result.startOver" }) === null;
      openMore(bar);
      expect(closed()).toBe(false);
      openMore(bar);
      expect(closed()).toBe(true);

      openMore(bar);
      fireEvent.keyDown(window, { key: "Escape" });
      expect(closed()).toBe(true);

      openMore(bar);
      fireEvent.click(document.querySelector<HTMLElement>("[data-more-backdrop]")!);
      expect(closed()).toBe(true);

      openMore(bar);
      fireEvent.click(bar.getByRole("button", { name: "wizard.result.startOver" }));
      expect(closed()).toBe(true);

      openMore(bar);
      fireEvent.click(bar.getByRole("button", { name: "regenerate default" }));
      expect(closed()).toBe(true);
    });

    it("stops listening for Escape once closed", () => {
      const removed = vi.spyOn(window, "removeEventListener");
      const { bar } = bars();
      openMore(bar);
      openMore(bar);
      expect(removed.mock.calls.some(([type]) => type === "keydown")).toBe(true);
      removed.mockRestore();
    });
  });

  describe("a kept plan's link by email", () => {
    const keptPlan = { token: "T".repeat(22), expiresAt: "2099-01-01T00:00:00.000Z" };
    const card = () => screen.queryByRole("region");

    it("can be asked for from More on a phone, which closes", () => {
      const { bar } = bars({ keptPlan });
      expect(card()).toBeNull();
      openMore(bar);
      fireEvent.click(bar.getByRole("button", { name: "wizard.kept.emailAction" }));
      expect(screen.getByRole("heading", { name: "wizard.kept.emailAction" })).toBeTruthy();
      expect(bar.queryByRole("button", { name: "wizard.result.startOver" })).toBeNull();
    });

    it("can be asked for beside Copy link on a wider screen", () => {
      const { header } = bars({ keptPlan });
      fireEvent.click(header.getByRole("button", { name: "wizard.kept.emailPill" }));
      expect(screen.getByRole("heading", { name: "wizard.kept.emailAction" })).toBeTruthy();
    });

    it("is offered once the save box closed, in its own words", () => {
      bars({ keptPlan, offerPlanEmail: true });
      expect(screen.getByRole("heading", { name: "wizard.kept.emailOffer" })).toBeTruthy();
    });

    it("isn't offered again after being closed, and can still be asked for", () => {
      const { header } = bars({ keptPlan, offerPlanEmail: true });
      fireEvent.click(screen.getByRole("button", { name: "closeModal" }));
      expect(card()).toBeNull();
      fireEvent.click(header.getByRole("button", { name: "wizard.kept.emailPill" }));
      expect(screen.getByRole("heading", { name: "wizard.kept.emailAction" })).toBeTruthy();
    });

    it("isn't there without a kept plan to link to", () => {
      const { header, bar } = bars({ offerPlanEmail: true });
      expect(card()).toBeNull();
      expect(header.queryByRole("button", { name: "wizard.kept.emailPill" })).toBeNull();
      openMore(bar);
      expect(bar.queryByRole("button", { name: "wizard.kept.emailAction" })).toBeNull();
    });

    it("goes away once the trip is saved", () => {
      const { header, bar } = bars({ keptPlan, offerPlanEmail: true, savedTripId: "t1", isUnsaved: false });
      expect(card()).toBeNull();
      expect(header.queryByRole("button", { name: "wizard.kept.emailPill" })).toBeNull();
      openMore(bar);
      expect(bar.queryByRole("button", { name: "wizard.kept.emailAction" })).toBeNull();
    });

    it("isn't there while the trip saves itself", () => {
      bars({ keptPlan, offerPlanEmail: true, autoSaving: true });
      expect(card()).toBeNull();
    });
  });

  it("shows a save under way on both Save buttons", () => {
    const { header, bar } = bars({ saving: true });
    expect(header.getByRole("button", { name: "wizard.result.saving" }).hasAttribute("disabled")).toBe(true);
    expect(bar.getByRole("button", { name: "wizard.result.saving" }).hasAttribute("disabled")).toBe(true);
  });
});
