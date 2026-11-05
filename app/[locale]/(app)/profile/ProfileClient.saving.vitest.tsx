import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

/**
 * Editing the profile saves by itself shortly after the last change. Whatever the
 * page says was saved has to be: every field edited while the wait runs goes in
 * the same save, leaving the page sends what's waiting, and a failed save puts back
 * only what it couldn't store.
 */

const s = vi.hoisted(() => ({
  writes: [] as Array<Record<string, unknown>>,
  ids: [] as unknown[],
  failNext: false,
  // Set to keep a save's answer back.
  answer: null as Promise<void> | null,
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en",
}));
vi.mock("@/lib/i18n/routing", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
  Link: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ addToast: () => {} }) }));
vi.mock("@/components/ui/MobileBottomNav", () => ({ default: () => null }));
vi.mock("@/components/profile/DeleteAccountModal", () => ({ default: () => null }));
vi.mock("@/components/beta", () => ({ BetaCodeInput: () => null }));
vi.mock("@/components/bananas", () => ({ ReferralDashboard: () => null }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      update: (values: Record<string, unknown>) => ({
        eq: async (_column: string, id: unknown) => {
          s.ids.push(id);
          const { updated_at: _at, ...changes } = values;
          s.writes.push(changes);
          const fails = s.failNext;
          s.failNext = false;
          await s.answer;
          return { error: fails ? { message: "refused" } : null };
        },
      }),
    }),
  }),
}));

import ProfileClient from "./ProfileClient";

const profile = {
  id: "u1",
  email: "ana@example.com",
  display_name: "Ana",
  avatar_url: null,
  bio: "",
  home_country: "Italy",
  home_city: "Rome",
  date_of_birth: null,
  languages: [],
  preferences: {},
  notification_settings: {
    emailNotifications: true,
    pushNotifications: false,
    tripReminders: true,
    dealAlerts: false,
    socialNotifications: false,
    marketingNotifications: true,
    quietHoursStart: 22,
    quietHoursEnd: 7,
  },
  privacy_settings: {
    privateProfile: false,
    showRealName: true,
    showTripHistory: true,
    showActivityStatus: true,
    showLocation: true,
    allowLocationTracking: false,
    disableFriendRequests: false,
  },
  created_at: "2026-01-01T00:00:00Z",
  last_sign_in_at: null,
};

const show = () =>
  render(
    <ProfileClient
      profile={profile}
      stats={{ totalTrips: 0, countriesVisited: 0, totalTravelDays: 0, upcomingTrips: 0 }}
      betaAccess={{ hasBetaAccess: false }}
      canUsePassword={false}
    />
  );

const field = (placeholder: string) => screen.getByPlaceholderText(placeholder) as HTMLInputElement;
const COUNTRY = "profile.fields.homeCountryPlaceholder";
const CITY = "profile.fields.homeCityPlaceholder";
const type = (placeholder: string, value: string) => fireEvent.change(field(placeholder), { target: { value } });
const wait = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

beforeEach(() => {
  vi.useFakeTimers();
  s.writes.length = 0;
  s.ids.length = 0;
  s.failNext = false;
  s.answer = null;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("saving the profile", () => {
  it("waits for the typing to stop, and saves the last value once", async () => {
    show();
    type(COUNTRY, "S");
    await wait(100);
    type(COUNTRY, "Sp");
    await wait(299);
    expect(s.writes).toEqual([]);
    await wait(1);
    expect(s.writes).toEqual([{ home_country: "Sp" }]);
    expect(s.ids).toEqual(["u1"]);
  });

  it("saves every field edited during the wait, in one save", async () => {
    show();
    type(COUNTRY, "Spain");
    await wait(100);
    type(CITY, "Madrid");
    await wait(300);
    expect(s.writes).toEqual([{ home_country: "Spain", home_city: "Madrid" }]);
  });

  it("says saved, then goes quiet", async () => {
    show();
    type(COUNTRY, "Spain");
    expect(screen.getByText("status.saving")).toBeTruthy();
    await wait(300);
    expect(screen.getByText("status.saved")).toBeTruthy();
    await wait(2000);
    expect(screen.queryByText("status.saved")).toBeNull();
  });

  it("sends what's waiting when the page is left", async () => {
    const { unmount } = show();
    type(COUNTRY, "Spain");
    unmount();
    await vi.advanceTimersByTimeAsync(0);
    expect(s.writes).toEqual([{ home_country: "Spain" }]);
  });

  it("sends nothing on leaving with nothing waiting", async () => {
    const { unmount } = show();
    type(COUNTRY, "Spain");
    await wait(300);
    unmount();
    await vi.advanceTimersByTimeAsync(0);
    expect(s.writes).toHaveLength(1);
  });

  it("puts back what a failed save couldn't store, and says so", async () => {
    show();
    s.failNext = true;
    type(COUNTRY, "Spain");
    await wait(300);
    expect(field(COUNTRY).value).toBe("Italy");
    expect(screen.getByText("status.error")).toBeTruthy();
  });

  it("goes back to the last value that was stored, not the first", async () => {
    show();
    type(COUNTRY, "Spain");
    await wait(300);
    s.failNext = true;
    type(COUNTRY, "France");
    await wait(300);
    expect(field(COUNTRY).value).toBe("Spain");
  });

  it("keeps an edit made while the save that fails was on its way, and saves it", async () => {
    let answer!: () => void;
    s.answer = new Promise<void>((resolve) => (answer = resolve));
    s.failNext = true;
    show();
    type(COUNTRY, "Spain");
    await wait(300);
    expect(s.writes).toEqual([{ home_country: "Spain" }]);

    s.answer = null;
    type(COUNTRY, "Portugal");
    answer();
    await wait(0);
    expect(field(COUNTRY).value).toBe("Portugal");
    await wait(300);
    expect(s.writes.at(-1)).toEqual({ home_country: "Portugal" });
  });

  it("saves a change to the settings with the rest of them", async () => {
    show();
    fireEvent.click(screen.getByText("profile.sections.travelPreferences"));
    fireEvent.change(screen.getByRole("combobox", { name: "profile.travelPrefs.wakeUpTime" }), { target: { value: "9" } });
    await wait(300);
    expect(s.writes).toEqual([
      { notification_settings: { ...profile.notification_settings, quietHoursEnd: 9 } },
    ]);
  });
});
