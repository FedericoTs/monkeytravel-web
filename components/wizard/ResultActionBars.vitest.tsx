import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import type { GeneratedItinerary } from "@/types";

const push = vi.fn();
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
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
    expect(bar.getByRole("button", { name: "share" })).toBeTruthy();
    // Both carry the page's share; the phone bar's keeps its margin.
    expect(shared).toEqual([share, { ...share, className: "mb-2" }]);
    expect(header.getByText("wizard.result.notSavedPill")).toBeTruthy();
    expect(bar.getByText("wizard.result.notSavedPill")).toBeTruthy();
    expect(header.getByText("wizard.result.saveHeaderNudge")).toBeTruthy();
    expect(bar.getByText("wizard.result.mobileSaveNudge")).toBeTruthy();
    expect(header.getByText("€900")).toBeTruthy();

    fireEvent.click(header.getByRole("button", { name: "wizard.result.saveTrip" }));
    expect(on.save).toHaveBeenCalledTimes(1);
  });

  it("puts a kept plan's link where the not-saved pill was, and says it is kept", () => {
    const { header, bar } = bars({ keptPlan: { token: "T".repeat(22), expiresAt: "2099-01-01T00:00:00.000Z" } });
    expect(header.getByRole("button", { name: "wizard.kept.copyLink" })).toBeTruthy();
    expect(bar.getByRole("button", { name: "wizard.kept.copyLink" })).toBeTruthy();
    expect(header.queryByText("wizard.result.notSavedPill")).toBeNull();
    expect(header.getByText("wizard.kept.headerNudge")).toBeTruthy();
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
    expect(bar.queryByRole("button", { name: crew })).toBeNull();
    expect(header.queryByTestId("export-menu")).toBeNull();
    expect(header.getByRole("link", { name: "result.savedViewTrip" }).getAttribute("href")).toBe("/trips/t2");
  });

  it("starts over and regenerates from both bars", () => {
    const { header, bar } = bars();
    fireEvent.click(header.getByRole("button", { name: "wizard.result.startOver" }));
    fireEvent.click(bar.getByRole("button", { name: "wizard.result.startOver" }));
    expect(on.startOver).toHaveBeenCalledTimes(2);
    fireEvent.click(header.getByRole("button", { name: "regenerate compact" }));
    fireEvent.click(bar.getByRole("button", { name: "regenerate icon-only" }));
    expect(on.regenerate).toHaveBeenCalledTimes(2);
  });

  it("shows a save under way on both Save buttons", () => {
    const { header, bar } = bars({ saving: true });
    expect(header.getByRole("button", { name: "wizard.result.saving" }).hasAttribute("disabled")).toBe(true);
    expect(bar.getByRole("button", { name: "wizard.result.saving" }).hasAttribute("disabled")).toBe(true);
  });
});
