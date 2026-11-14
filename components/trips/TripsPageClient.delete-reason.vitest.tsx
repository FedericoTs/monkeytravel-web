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
 * Deleting a trip from My Trips asks why, in one tap and only if someone wants
 * to say: without it, nobody knows why a trip was deleted and made again. The
 * answer is sent before the delete, and never stands in its way.
 */

const trip = {
  id: "trip-1",
  title: "Honolulu Trip",
  start_date: "2030-04-01",
  end_date: "2030-04-08",
  status: "planning",
  cover_image_url: "https://images.example/honolulu.jpg",
  created_at: "2026-10-01T10:00:00Z",
  is_archived: false,
};

const trips = common.trips;
const reasons = common.startOver.reasons;

function show() {
  render(
    <NextIntlClientProvider locale="en" messages={{ common }} onError={() => {}}>
      <TripsPageClient trips={[trip]} displayName="Ana" lifetimeConversions={0} serverToday="2026-11-05" />
    </NextIntlClientProvider>
  );
}

async function openFromMenu(item: string) {
  const card = screen.getByRole("img", { name: trip.title }).closest("a")!;
  fireEvent.click(within(card).getByRole("button", { name: trips.tripActions }));
  fireEvent.click(within(card).getByRole("menuitem", { name: item }));
  return screen.findByRole("dialog");
}

async function confirm(dialog: HTMLElement, label: string) {
  await act(async () => {
    fireEvent.click(within(dialog).getAllByRole("button", { name: label }).at(-1)!);
  });
}

let fetchMock: ReturnType<typeof vi.fn>;
const calls = () => fetchMock.mock.calls.map(([url, init]) => [url, (init as RequestInit | undefined)?.method]);

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

describe("deleting a trip from My Trips", () => {
  it("asks what didn't work, and sends the answer before the delete", async () => {
    show();
    const dialog = await openFromMenu(trips.deleteTrip);
    expect(within(dialog).getByText(trips.deleteReason)).toBeTruthy();
    const wrongDates = within(dialog).getByRole("button", { name: reasons.wrong_dates });
    fireEvent.click(wrongDates);
    expect(wrongDates.getAttribute("aria-pressed")).toBe("true");
    await confirm(dialog, trips.deleteTrip);

    expect(calls()).toEqual([
      ["/api/trips/trip-1/deletion-feedback", "POST"],
      ["/api/trips/trip-1", "DELETE"],
    ]);
    const sent = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(sent).toMatchObject({ reason: "wrong_dates", destination: "Honolulu Trip", was_auto_saved: false });
    expect(sent.trip_age_seconds).toBeGreaterThan(0);
    expect(s.refresh).toHaveBeenCalledTimes(1);
  });

  it("deletes without an answer, and sends none", async () => {
    show();
    await confirm(await openFromMenu(trips.deleteTrip), trips.deleteTrip);
    expect(calls()).toEqual([["/api/trips/trip-1", "DELETE"]]);
  });

  it("takes an answer back on a second tap", async () => {
    show();
    const dialog = await openFromMenu(trips.deleteTrip);
    const other = within(dialog).getByRole("button", { name: reasons.other });
    fireEvent.click(other);
    fireEvent.click(other);
    expect(other.getAttribute("aria-pressed")).toBe("false");
    await confirm(dialog, trips.deleteTrip);
    expect(calls()).toEqual([["/api/trips/trip-1", "DELETE"]]);
  });

  it("still deletes when the answer can't be sent", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/deletion-feedback")) throw new TypeError("Failed to fetch");
      return Response.json({ success: true });
    });
    show();
    const dialog = await openFromMenu(trips.deleteTrip);
    fireEvent.click(within(dialog).getByRole("button", { name: reasons.too_expensive }));
    await confirm(dialog, trips.deleteTrip);
    expect(calls().at(-1)).toEqual(["/api/trips/trip-1", "DELETE"]);
    expect(s.refresh).toHaveBeenCalledTimes(1);
    expect(s.toast).not.toHaveBeenCalled();
  });

  it("asks nothing when archiving", async () => {
    show();
    const dialog = await openFromMenu(trips.archiveTrip);
    expect(within(dialog).queryByText(trips.deleteReason)).toBeNull();
    expect(within(dialog).queryByRole("button", { name: reasons.wrong_dates })).toBeNull();
  });
});
