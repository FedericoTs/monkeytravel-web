import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import common from "@/messages/en/common.json";

const s = vi.hoisted(() => ({ refresh: vi.fn(), toast: vi.fn() }));

vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));
vi.mock("@/lib/i18n/routing", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
  useRouter: () => ({ refresh: s.refresh, push: vi.fn() }),
}));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ addToast: s.toast }) }));
vi.mock("@/hooks/usePullToRefresh", () => ({
  usePullToRefresh: () => ({ isRefreshing: false, pullDistance: 0 }),
}));
vi.mock("@/lib/native/haptics", () => ({ hapticLight: vi.fn() }));
vi.mock("@/components/ui/MobileBottomNav", () => ({ default: () => null }));
vi.mock("@/components/ui/PullToRefreshIndicator", () => ({ PullToRefreshIndicator: () => null }));
vi.mock("@/components/templates/CuratedEscapesClient", () => ({ default: () => null }));
vi.mock("@/components/blog/BlogTipsSection", () => ({ default: () => null }));
vi.mock("@/components/referral/ReferralModal", () => ({ default: () => null }));

import TripsPageClient from "./TripsPageClient";

/**
 * Archiving hides a trip from My Trips and promises it can be restored: archived
 * trips wait under their own heading, closed until asked for, and each has a way
 * back.
 */

const trip = (title: string, is_archived: boolean) => ({
  id: title,
  title,
  start_date: "2030-04-01",
  end_date: "2030-04-08",
  status: "planning",
  cover_image_url: `https://images.example/${title}.jpg`,
  created_at: "2026-10-01T10:00:00Z",
  is_archived,
});

const show = (trips = [trip("Kept", false), trip("Put away", true)]) =>
  render(
    <NextIntlClientProvider locale="en" messages={{ common }} onError={() => {}}>
      <TripsPageClient trips={trips} displayName="Ana" lifetimeConversions={0} serverToday="2026-11-05" />
    </NextIntlClientProvider>
  );

const trips = common.trips;
const cardOf = (title: string) => screen.queryByRole("img", { name: title });
const openArchived = () => fireEvent.click(screen.getByRole("button", { name: new RegExp(trips.showArchived) }));

/** Takes the card's menu through to the dialog's confirm button. */
async function confirmFromMenu(title: string, item: string, confirm: string) {
  const card = cardOf(title)!.closest("a")!;
  fireEvent.click(within(card).getByRole("button", { name: trips.tripActions }));
  fireEvent.click(within(card).getByRole("menuitem", { name: item }));
  const dialog = await screen.findByRole("dialog");
  await act(async () => {
    fireEvent.click(within(dialog).getByRole("button", { name: confirm }));
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  s.refresh.mockClear();
  s.toast.mockClear();
  fetchMock = vi.fn(async () => Response.json({ success: true }));
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("archived trips on My Trips", () => {
  it("wait closed under their own heading, with their count", () => {
    show();
    expect(cardOf("Kept")).not.toBeNull();
    expect(cardOf("Put away")).toBeNull();
    expect(screen.getByRole("button", { name: new RegExp(trips.showArchived) }).textContent).toContain("(1)");
  });

  it("show when asked for, and close again", () => {
    show();
    openArchived();
    expect(cardOf("Put away")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: new RegExp(trips.hideArchived) }));
    expect(cardOf("Put away")).toBeNull();
  });

  it("aren't counted among the trips", () => {
    const { container } = show([trip("Put away", true)]);
    expect(container.textContent).toContain(trips.noTripsYet);
    openArchived();
    expect(cardOf("Put away")).not.toBeNull();
  });

  it("can be restored from the card, which reloads the list", async () => {
    show();
    openArchived();
    await confirmFromMenu("Put away", trips.unarchiveTrip, trips.unarchiveTrip);
    expect(fetchMock).toHaveBeenCalledWith("/api/trips/Put away/archive", { method: "DELETE" });
    expect(s.refresh).toHaveBeenCalledTimes(1);
    expect(s.toast).not.toHaveBeenCalled();
  });

  it("says so when restoring fails, and doesn't reload", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 500 }));
    show();
    openArchived();
    await confirmFromMenu("Put away", trips.unarchiveTrip, trips.unarchiveTrip);
    expect(s.toast).toHaveBeenCalledWith(trips.unarchiveError, "error");
    expect(s.refresh).not.toHaveBeenCalled();
  });

  it("are archived from a kept trip's card", async () => {
    show();
    await confirmFromMenu("Kept", trips.archiveTrip, trips.archiveTrip);
    expect(fetchMock).toHaveBeenCalledWith("/api/trips/Kept/archive", { method: "POST" });
    expect(s.refresh).toHaveBeenCalledTimes(1);
  });
});
