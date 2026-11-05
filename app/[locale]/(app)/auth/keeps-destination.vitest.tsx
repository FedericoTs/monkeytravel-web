import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

/**
 * Sign in and sign up link to each other, and someone on their way to a page
 * (a ready-made trip they were saving, an invite) stays on their way when they
 * switch. Without a page to go back to, or with one from elsewhere, the links
 * stay plain.
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

const DESTINATION = "/trips/template/tpl-1";

const hrefOf = (name: string) => screen.getByRole("link", { name }).getAttribute("href");

beforeEach(() => {
  s.search = "";
});

afterEach(cleanup);

describe("the sign in page's link to sign up", () => {
  const show = async () => {
    const { default: LoginPage } = await import("./login/page");
    render(<LoginPage />);
  };

  it("keeps where they were going", async () => {
    s.search = `redirect=${encodeURIComponent(DESTINATION)}`;
    await show();
    expect(hrefOf("signUpLink")).toBe(`/auth/signup?redirect=${encodeURIComponent(DESTINATION)}`);
  });

  it("is plain with nowhere to go back to, or somewhere off the site", async () => {
    await show();
    expect(hrefOf("signUpLink")).toBe("/auth/signup");
    cleanup();

    s.search = `redirect=${encodeURIComponent("https://evil.example/trips")}`;
    await show();
    expect(hrefOf("signUpLink")).toBe("/auth/signup");
  });
});

describe("the sign up page's link to sign in", () => {
  const show = async () => {
    const { default: SignupPage } = await import("./signup/page");
    render(<SignupPage />);
  };

  it("keeps where they were going", async () => {
    s.search = `redirect=${encodeURIComponent(DESTINATION)}`;
    await show();
    expect(hrefOf("signInLink")).toBe(`/auth/login?redirect=${encodeURIComponent(DESTINATION)}`);
  });

  it("is plain with nowhere to go back to, or somewhere off the site", async () => {
    await show();
    expect(hrefOf("signInLink")).toBe("/auth/login");
    cleanup();

    s.search = `redirect=${encodeURIComponent("//evil.example/trips")}`;
    await show();
    expect(hrefOf("signInLink")).toBe("/auth/login");
  });
});
