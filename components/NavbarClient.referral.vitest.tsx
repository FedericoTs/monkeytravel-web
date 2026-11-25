import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

/**
 * The top bar offers no Share into the referral program, on a wide screen or in
 * the phone menu.
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
  vi.unstubAllGlobals();
  auth.user = null;
});

function showSignedIn() {
  auth.user = { id: "u1", email: "someone@example.com" };
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ admin: false }))));
  render(<NavbarClient navLinks={[]} />);
  // Open the phone menu, so it is looked at too.
  fireEvent.click(screen.getByRole("button", { name: "navigation.toggleMenu" }));
}

const shareButtons = () => screen.queryAllByRole("button", { name: "buttons.share" });

describe("the top bar's Share, the referral program's way in", () => {
  it("isn't offered to a signed-in visitor, on a wide screen or in the phone menu", () => {
    showSignedIn();
    expect(shareButtons()).toHaveLength(0);
  });
});
