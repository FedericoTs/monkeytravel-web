import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

/**
 * Someone signed out who saves a ready-made trip goes off to sign up. Back on
 * the trip's page, signed in, the save dialog opens again with the date they
 * picked, so signing up finishes the save instead of forgetting it.
 */

const s = vi.hoisted(() => ({
  user: null as { id: string } | null,
  loading: false,
  saved: null as string | null,
  saveProps: null as { isOpen: boolean; templateId?: string; initialStartDate?: string } | null,
}));

vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ user: s.user, loading: s.loading }) }));
vi.mock("@/components/ui/SaveTripModal", async () => {
  const { useCallback } = await import("react");
  return {
    default: (props: NonNullable<typeof s.saveProps>) => {
      s.saveProps = props;
      return <div data-testid="save-dialog" data-open={String(props.isOpen)} />;
    },
    usePendingSaveTripAction: () => ({
      getPending: useCallback(async () => (s.saved ? JSON.parse(s.saved) : null), []),
      clearPending: useCallback(async () => {
        s.saved = null;
      }, []),
    }),
  };
});
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));
vi.mock("@/lib/i18n/routing", () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock("@/lib/analytics", () => ({ trackTemplateBrowsed: () => {} }));
vi.mock("@/components/DestinationHero", () => ({ default: () => null }));
vi.mock("@/components/trip/TripPackingEssentials", () => ({ default: () => null }));
vi.mock("@/components/trip/ViewControls", () => ({ MapToggle: () => null, ViewModeToggle: () => null }));
vi.mock("@/components/ui/MobileBottomNav", () => ({ default: () => null }));
vi.mock("@/hooks/useTravelDistances", () => ({ useTravelDistances: () => ({}) }));
vi.mock("@/lib/locale", () => ({ useCurrency: () => ({ convert: (n: number) => n, format: (n: number) => String(n) }) }));
vi.mock("@/components/trip/ReadOnlyItinerary", () => ({ default: () => null }));
vi.mock("@/hooks/useSharedTripVisit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useSharedTripVisit")>();
  return { useSharedTripSave: actual.useSharedTripSave };
});

import TemplatePreviewClient from "./TemplatePreviewClient";

const template = {
  id: "tpl-1",
  title: "Rome in 3 days",
  description: "A short city break",
  destination: "Rome",
  country: "Italy",
  countryCode: "IT",
  durationDays: 3,
  budgetTier: "balanced",
  moodTags: [],
  tags: [],
  copyCount: 0,
  itinerary: [],
  packingList: [],
};

const pending = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ templateId: "tpl-1", tripTitle: "Rome in 3 days", startDate: "2027-05-10", timestamp: Date.now(), ...over });

const show = async () => {
  render(
    <NextIntlClientProvider locale="en" messages={{}} onError={() => {}} getMessageFallback={({ key }) => key}>
      <TemplatePreviewClient template={template} />
    </NextIntlClientProvider>
  );
  await act(async () => {});
};
const dialogOpen = () => screen.getByTestId("save-dialog").getAttribute("data-open") === "true";

beforeEach(() => {
  s.user = { id: "u1" };
  s.loading = false;
  s.saved = null;
  s.saveProps = null;
});

afterEach(cleanup);

describe("a ready-made trip's page", () => {
  it("opens the save dialog again after signing up, on the date they picked, once", async () => {
    s.saved = pending();
    await show();
    expect(dialogOpen()).toBe(true);
    expect(s.saveProps).toMatchObject({ templateId: "tpl-1", initialStartDate: "2027-05-10" });
    expect(s.saved).toBeNull();
  });

  it("waits while the visitor isn't signed in, or it isn't known yet", async () => {
    s.saved = pending();
    s.user = null;
    await show();
    expect(dialogOpen()).toBe(false);
    expect(s.saved).not.toBeNull();
    cleanup();

    s.user = { id: "u1" };
    s.loading = true;
    await show();
    expect(dialogOpen()).toBe(false);
    expect(s.saved).not.toBeNull();
  });

  it.each([
    ["another ready-made trip", { templateId: "tpl-2" }],
    ["a shared trip", { templateId: undefined, shareToken: "tok" }],
  ])("leaves a save meant for %s", async (_name, over) => {
    s.saved = pending(over);
    await show();
    expect(dialogOpen()).toBe(false);
    expect(s.saved).not.toBeNull();
  });

  it("stays closed with nothing waiting", async () => {
    await show();
    expect(dialogOpen()).toBe(false);
  });
});
