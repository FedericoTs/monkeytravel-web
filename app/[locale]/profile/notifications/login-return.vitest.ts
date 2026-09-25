// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { safeNextOrDefault } from "@/lib/security/safe-next";
import { returnsToPage } from "@/lib/auth/first-login";

/**
 * Signed-out visitors to the settings pages sign in and come back.
 *
 * Both pages sent them to /auth/login?next=…, a parameter the login page never
 * reads (it reads `redirect`), so after signing in they landed on My Trips.
 * /profile/notifications is the "Manage preferences" link in every email.
 */

class Redirect extends Error {
  constructor(public url: string) {
    super(`redirect ${url}`);
  }
}
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Redirect(url);
  },
}));
vi.mock("./NotificationPreferencesClient", () => ({ default: () => null }));
vi.mock("../../settings/payment-handles/PaymentHandlesClient", () => ({ default: () => null }));

let user: { id: string } | null = null;
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user } }) } }),
}));

type Page = (props: { params: Promise<{ locale: string }> }) => Promise<unknown>;

/** Where the page sends this visitor, or null when it renders. */
async function landing(page: Page, locale: string): Promise<string | null> {
  try {
    await page({ params: Promise.resolve({ locale }) });
    return null;
  } catch (e) {
    if (e instanceof Redirect) return e.url;
    throw e;
  }
}

describe.each([
  ["/profile/notifications", () => import("./page")],
  ["/settings/payment-handles", () => import("../../settings/payment-handles/page")],
])("%s", (path, load) => {
  beforeEach(() => {
    user = null;
  });

  it.each([
    ["en", ""],
    ["es", "/es"],
    ["it", "/it"],
    ["pt", "/pt"],
  ])("signed out (%s): signs in, then comes back here", async (locale, prefix) => {
    const { default: page } = await load();
    const url = await landing(page as Page, locale);
    expect(url).toBe(`${prefix}/auth/login?redirect=${encodeURIComponent(path)}`);

    // What the login page makes of it (app/[locale]/auth/login/page.tsx).
    const params = new URL(url!, "https://monkeytravel.app").searchParams;
    const destination = safeNextOrDefault(params.get("redirect"), "/trips");
    expect(destination).toBe(path);
    expect(returnsToPage(destination)).toBe(true);
  });

  it("signed in: the page renders", async () => {
    user = { id: "user-1" };
    const { default: page } = await load();
    expect(await landing(page as Page, "en")).toBeNull();
  });
});
