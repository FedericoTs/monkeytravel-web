import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import itCommon from "@/messages/it/common.json";
import enCommon from "@/messages/en/common.json";

/**
 * The profile in the page's language: the languages someone speaks, sharing their
 * invite link, and the answer when their data can't be exported again today.
 * What's stored stays as it was: languages by their English names.
 */

const s = vi.hoisted(() => ({
  toasts: [] as Array<[string, string]>,
  writes: [] as Array<Record<string, unknown>>,
  onShare: null as null | (() => Promise<void>),
}));

vi.mock("@/lib/i18n/routing", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
  Link: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock("@/components/ui/Toast", () => ({
  useToast: () => ({ addToast: (text: string, kind: string) => s.toasts.push([text, kind]) }),
}));
vi.mock("@/components/ui/MobileBottomNav", () => ({ default: () => null }));
vi.mock("@/components/profile/DeleteAccountModal", () => ({ default: () => null }));
vi.mock("@/components/beta", () => ({ BetaCodeInput: () => null }));
vi.mock("@/components/bananas", () => ({
  ReferralDashboard: ({ onShare }: { onShare: () => Promise<void> }) => {
    s.onShare = onShare;
    return null;
  },
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      update: (values: Record<string, unknown>) => ({
        eq: async () => {
          const { updated_at: _at, ...changes } = values;
          s.writes.push(changes);
          return { error: null };
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
  home_country: "",
  home_city: "",
  date_of_birth: null,
  languages: ["german"],
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

const show = (locale: "en" | "it") =>
  render(
    <NextIntlClientProvider
      locale={locale}
      messages={{ common: locale === "it" ? itCommon : enCommon }}
      onError={() => {}}
      getMessageFallback={({ key }) => key}
    >
      <ProfileClient
        profile={profile}
        stats={{ totalTrips: 0, countriesVisited: 0, totalTravelDays: 0, upcomingTrips: 0 }}
        betaAccess={{ hasBetaAccess: false }}
        canUsePassword={false}
      />
    </NextIntlClientProvider>
  );

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  s.toasts.length = 0;
  s.writes.length = 0;
  s.onShare = null;
  fetchMock = vi.fn(async () => Response.json({ code: "ABC" }));
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("the languages someone speaks", () => {
  it("are named in the page's language, capitalised", () => {
    show("it");
    expect(screen.getByRole("button", { name: "Inglese" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "English" })).toBeNull();
  });

  it("are still stored by their English names", async () => {
    vi.useFakeTimers();
    show("it");
    fireEvent.click(screen.getByRole("button", { name: "Inglese" }));
    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(s.writes).toEqual([{ languages: ["german", "english"] }]);
  });

  it("show what's stored as chosen, and can be taken off", async () => {
    vi.useFakeTimers();
    show("en");
    fireEvent.click(screen.getByRole("button", { name: "German" }));
    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(s.writes).toEqual([{ languages: [] }]);
  });
});

describe("sharing the invite link", () => {
  const share = () => act(async () => s.onShare!());

  it("uses the page's language in the share sheet", async () => {
    const nativeShare = vi.fn(async () => {});
    vi.stubGlobal("navigator", { ...navigator, share: nativeShare });
    show("it");
    await share();
    expect(nativeShare).toHaveBeenCalledWith({
      title: itCommon.profile.referralShare.title,
      text: itCommon.profile.referralShare.text,
      url: expect.stringContaining("/join/ABC"),
    });
    expect(s.toasts).toEqual([]);
  });

  it("says the link was copied where there's no share sheet", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { ...navigator, share: undefined, clipboard: { writeText } });
    show("it");
    await share();
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("/join/ABC"));
    expect(s.toasts).toEqual([[itCommon.profile.referralShare.copied, "success"]]);
  });

  it("says nothing when the share sheet is closed", async () => {
    const closed = Object.assign(new Error("closed"), { name: "AbortError" });
    vi.stubGlobal("navigator", { ...navigator, share: vi.fn(async () => Promise.reject(closed)) });
    show("it");
    await share();
    expect(s.toasts).toEqual([]);
  });

  it("says so when the link can't be got", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 500 }));
    show("it");
    await share();
    expect(s.toasts).toEqual([[itCommon.profile.referralShare.failed, "error"]]);
  });
});

describe("exporting their data", () => {
  const saved = vi.fn(() => "blob:export");
  const showAccount = () => {
    saved.mockClear();
    window.URL.createObjectURL = saved;
    show("it");
    fireEvent.click(screen.getByText(itCommon.profile.sections.account));
  };
  const exportData = async () => {
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: new RegExp(itCommon.dataExport.button) }));
    });
  };

  it("says in the page's language that it's once a day, not the server's English", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: "You can only export your data once per day." }, { status: 429 }));
    showAccount();
    await exportData();
    expect(s.toasts).toEqual([[itCommon.dataExport.rateLimited, "error"]]);
    expect(saved).not.toHaveBeenCalled();
  });

  it("says it failed in the page's language for anything else, even a dropped connection", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: "Failed to export data" }, { status: 500 }));
    showAccount();
    await exportData();
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await exportData();
    expect(s.toasts).toEqual([
      [itCommon.dataExport.error, "error"],
      [itCommon.dataExport.error, "error"],
    ]);
  });
});
