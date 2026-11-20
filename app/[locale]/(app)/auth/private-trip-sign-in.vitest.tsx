import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

/**
 * A private trip's own address sends a signed-out visitor to sign in. Some are
 * its owner on another device; others were sent the address by the owner and
 * can't open it even with an account. The page said "Welcome back" to both, and
 * they left. It now says what the page is for, what to ask the owner for, and
 * how to plan a trip of their own. Other sign-ins keep the usual words.
 */

const s = vi.hoisted(() => ({ search: "" }));

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(s.search) }));
vi.mock("next-intl", () => ({ useLocale: () => "en", useTranslations: () => (key: string) => key }));
vi.mock("@/lib/i18n/routing", () => ({
  useRouter: () => ({ push: () => {} }),
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: {} }) }));
vi.mock("@/lib/analytics", () => ({ trackLogin: () => {}, setUserId: () => {}, trackSignup: () => {} }));
vi.mock("@/lib/posthog/events", () => ({ captureUserLoggedIn: () => {}, captureUserSignedUp: () => {} }));
vi.mock("@/lib/posthog/identify", () => ({ identify: () => {}, aliasAnonToUser: () => {} }));
vi.mock("@/components/auth/OAuthButtons", () => ({ OAuthButtons: () => null }));

const TRIP = "/trips/0f3c1a2b-4d5e-4f60-8a7b-9c0d1e2f3a4b";

const show = async (redirect?: string) => {
  s.search = redirect === undefined ? "" : `redirect=${encodeURIComponent(redirect)}`;
  const { default: LoginPage } = await import("./login/page");
  render(<LoginPage />);
};

beforeEach(() => {
  s.search = "";
});

afterEach(cleanup);

describe("signing in on the way to a private trip", () => {
  it("says the trip is private, what to ask its owner for, and offers a trip of their own", async () => {
    await show(TRIP);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("tripTitle");
    expect(screen.getByText("tripSubtitle")).toBeTruthy();
    expect(screen.getByText("tripNote")).toBeTruthy();
    expect(screen.getByRole("link", { name: "tripPlanOwn" }).getAttribute("href")).toBe("/trips/new");
    expect(screen.queryByText("title")).toBeNull();
  });

  it("knows the trip's address with a language in front or a slash at the end", async () => {
    await show(`/it${TRIP}`);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("tripTitle");
    cleanup();
    await show(`${TRIP}/`);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("tripTitle");
  });

  it("keeps the usual words for other sign-ins", async () => {
    for (const redirect of [undefined, "/trips", "/trips/new", "/trips/template/tpl-1", `${TRIP}/edit`, "/invite/abc", "/shared/abc"]) {
      await show(redirect);
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("title");
      expect(screen.getByText("subtitle")).toBeTruthy();
      expect(screen.queryByText("tripNote")).toBeNull();
      expect(screen.queryByRole("link", { name: "tripPlanOwn" })).toBeNull();
      cleanup();
    }
  });
});
