import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";

vi.mock("next-intl", () => ({ useTranslations: (ns: string) => (key: string) => `${ns}:${key}` }));
vi.mock("@/lib/i18n/routing", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const shared: Record<string, unknown>[] = [];
vi.mock("@/components/trip/ShareButton", () => ({
  default: (p: Record<string, unknown>) => {
    shared.push(p);
    return <div data-testid="share" />;
  },
}));
vi.mock("@/components/calendar/DownloadIcsButton", () => ({ default: () => <div data-testid="ics" /> }));
vi.mock("next/dynamic", () => ({ default: () => () => <div data-testid="export" /> }));

import TripControlsBar from "./TripControlsBar";

type Props = ComponentProps<typeof TripControlsBar>;
const bar = (over: Partial<Props> = {}) => {
  shared.length = 0;
  const props: Props = {
    trip: { id: "t1", title: "Lisbon", startDate: "2027-05-10", endDate: "2027-05-12", budget: null, meta: { trip_intent: "group" } as Props["trip"]["meta"] },
    viewMode: "cards",
    setViewMode: vi.fn(),
    showMap: true,
    setShowMap: vi.fn(),
    isEditMode: false,
    crewShareRequest: 0,
    isOwner: true,
    shouldAutoOpenShareModal: false,
    canUseAssistant: true,
    onOpenAssistant: vi.fn(),
    displayItinerary: [],
    emailParseEnabled: true,
    onPasteBooking: vi.fn(),
    children: <div data-testid="edit-controls" />,
    ...over,
  };
  render(<TripControlsBar {...props} />);
  return props;
};

afterEach(cleanup);

describe("TripControlsBar", () => {
  it("leads back to the trips and keeps the editing controls last", () => {
    bar();
    expect(screen.getByRole("link").getAttribute("href")).toBe("/trips");
    // From the sm width up: a phone has the tab bar for it, and no room above the plan.
    expect(screen.getByRole("link").parentElement?.className).toContain("hidden sm:flex");
    expect(screen.getByTestId("edit-controls")).toBeTruthy();
  });

  it("switches the view and the map", () => {
    const props = bar();
    fireEvent.click(screen.getByRole("button", { name: "trips:detail.timeline" }));
    expect(props.setViewMode).toHaveBeenCalledWith("timeline");
    fireEvent.click(screen.getByRole("button", { name: /trips:detail\.hideMap/ }));
    expect(props.setShowMap).toHaveBeenCalledWith(false);
  });

  it("opens sharing on Invite from an invite link, and on Share when a crew banner asks", () => {
    bar({ shouldAutoOpenShareModal: true });
    expect(shared[0]).toMatchObject({ autoOpen: true, initialTab: "invite", canManageSharing: true, tripIntent: "group" });
    cleanup();

    bar({ shouldAutoOpenShareModal: true, crewShareRequest: 1 });
    expect(shared[0]).toMatchObject({ autoOpen: true, initialTab: "share" });
    cleanup();

    bar({ crewShareRequest: 1 });
    expect(shared[0]).toMatchObject({ autoOpen: true, initialTab: "share" });
    cleanup();

    bar({ isOwner: false });
    expect(shared[0]).toMatchObject({ autoOpen: false, initialTab: "share", canManageSharing: false });
  });

  it("offers Edit with AI only with the assistant, and imports from email from the More menu", () => {
    const props = bar();
    fireEvent.click(screen.getByTitle("trips:detail.editWithAi"));
    expect(props.onOpenAssistant).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /trips:detail\.more/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /common:addFromEmail\.button/ }));
    expect(props.onPasteBooking).toHaveBeenCalledTimes(1);
    cleanup();

    bar({ canUseAssistant: false, emailParseEnabled: false });
    expect(screen.queryByTitle("trips:detail.editWithAi")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /trips:detail\.more/ }));
    expect(screen.queryByRole("menuitem", { name: /common:addFromEmail\.button/ })).toBeNull();
  });

  it("keeps only the way back, the toggles and the editing controls in edit mode", () => {
    bar({ isEditMode: true });
    expect(screen.queryByTestId("share")).toBeNull();
    expect(screen.queryByTitle("trips:detail.editWithAi")).toBeNull();
    expect(screen.queryByRole("button", { name: /trips:detail\.more/ })).toBeNull();
    expect(screen.getByTestId("edit-controls")).toBeTruthy();
  });

  it("hands its Edit with AI button to the page, which watches whether it is on screen", () => {
    const watch = vi.fn();
    bar({ assistantButtonRef: watch });
    expect(watch).toHaveBeenCalledWith(screen.getByTitle("trips:detail.editWithAi"));
  });
});
