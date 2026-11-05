import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

/**
 * A photo the person uploaded is served from our storage, which the image
 * optimiser refuses, so it's shown as it is. A photo that can't be used says
 * why, in the page's language, and isn't sent.
 */

const s = vi.hoisted(() => ({ toasts: [] as Array<[string, string]> }));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en",
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
vi.mock("@/components/bananas", () => ({ ReferralDashboard: () => null }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));

import ProfileClient from "./ProfileClient";

const STORED_PHOTO = "https://ref.supabase.co/storage/v1/object/public/avatars/u1/1.png";

const profile = {
  id: "u1",
  email: "ana@example.com",
  display_name: "Ana",
  avatar_url: STORED_PHOTO as string | null,
  bio: "",
  home_country: "",
  home_city: "",
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

const show = (over: Partial<typeof profile> = {}) =>
  render(
    <ProfileClient
      profile={{ ...profile, ...over }}
      stats={{ totalTrips: 0, countriesVisited: 0, totalTravelDays: 0, upcomingTrips: 0 }}
      betaAccess={{ hasBetaAccess: false }}
      canUsePassword={false}
    />
  );

const pick = async (file: File) => {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  await act(async () => {
    fireEvent.change(input, { target: { files: [file] } });
  });
};
const photo = (type: string, bytes: number) => new File([new Uint8Array(bytes)], "me", { type });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  s.toasts.length = 0;
  fetchMock = vi.fn(async () => Response.json({ avatar_url: `${STORED_PHOTO}?new` }));
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the profile photo", () => {
  it("shows a stored photo at its own address", () => {
    show();
    expect(screen.getByRole("img", { name: "Ana" }).getAttribute("src")).toBe(STORED_PHOTO);
  });

  it("shows the new photo after an upload", async () => {
    show();
    await pick(photo("image/png", 10));
    expect(fetchMock).toHaveBeenCalledWith("/api/profile/avatar", expect.objectContaining({ method: "POST" }));
    expect(screen.getByRole("img", { name: "Ana" }).getAttribute("src")).toBe(`${STORED_PHOTO}?new`);
    expect(s.toasts).toEqual([]);
  });

  it("refuses a photo over 5 MB, saying why, without sending it", async () => {
    show();
    await pick(photo("image/png", 5 * 1024 * 1024 + 1));
    expect(s.toasts).toEqual([["profile.avatarTooLarge", "error"]]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("takes a photo of exactly 5 MB", async () => {
    show();
    await pick(photo("image/jpeg", 5 * 1024 * 1024));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuses a file that isn't a photo it can use, saying why, without sending it", async () => {
    show();
    await pick(photo("application/pdf", 10));
    expect(s.toasts).toEqual([["profile.avatarWrongType", "error"]]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("says so when the upload fails, whether the server answered or not, and keeps the old photo", async () => {
    show();
    fetchMock.mockResolvedValueOnce(Response.json({ error: "Failed to upload avatar" }, { status: 500 }));
    await pick(photo("image/png", 10));
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await pick(photo("image/png", 10));
    expect(s.toasts).toEqual([
      ["profile.avatarFailed", "error"],
      ["profile.avatarFailed", "error"],
    ]);
    expect(screen.getByRole("img", { name: "Ana" }).getAttribute("src")).toBe(STORED_PHOTO);
  });
});
