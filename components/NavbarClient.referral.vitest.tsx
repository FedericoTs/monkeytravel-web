import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

/**
 * The top bar's Share opens the referral program (invite friends, earn rewards).
 * It shows to a signed-in visitor only while referrals are switched on.
 */

const auth = vi.hoisted(() => ({ user: null as { id: string; email: string } | null }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ user: auth.user, loading: false }) }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/lib/i18n/routing", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/LanguageSwitcher", () => ({ default: () => null }));

import NavbarClient from "./NavbarClient";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  auth.user = null;
});

function showSignedIn() {
  auth.user = { id: "u1", email: "someone@example.com" };
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ admin: false }))));
  render(<NavbarClient navLinks={[]} />);
  // The phone menu has its own Share: open it too.
  fireEvent.click(screen.getByRole("button", { name: "navigation.toggleMenu" }));
}

const shareButtons = () => screen.queryAllByRole("button", { name: "buttons.share" });

describe("the top bar's Share, the referral program's way in", () => {
  it("isn't offered, on a wide screen or in the phone menu, with referrals switched off", () => {
    vi.stubEnv("NEXT_PUBLIC_REFERRALS_ENABLED", "false");
    showSignedIn();
    expect(shareButtons()).toHaveLength(0);
  });

  it("is offered in both with referrals switched on", () => {
    vi.stubEnv("NEXT_PUBLIC_REFERRALS_ENABLED", "true");
    showSignedIn();
    expect(shareButtons()).toHaveLength(2);
  });
});
