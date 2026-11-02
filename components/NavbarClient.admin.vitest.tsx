import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

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
  vi.unstubAllGlobals();
  auth.user = null;
});

const adminLinks = () => document.querySelectorAll('a[href="/admin"]');

describe("the navbar's link to /admin", () => {
  it("shows for a visitor the server calls an admin", async () => {
    auth.user = { id: "u1", email: "someone@example.com" };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ admin: true })));
    vi.stubGlobal("fetch", fetchMock);
    render(<NavbarClient navLinks={[]} />);
    await waitFor(() => expect(adminLinks().length).toBeGreaterThan(0));
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/admin");
  });

  it("stays hidden for anyone else", async () => {
    auth.user = { id: "u2", email: "guest@example.com" };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ admin: false })));
    vi.stubGlobal("fetch", fetchMock);
    render(<NavbarClient navLinks={[]} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(adminLinks().length).toBe(0);
  });

  it("asks nothing for a signed-out visitor", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<NavbarClient navLinks={[]} />);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(adminLinks().length).toBe(0);
    expect(screen.getAllByRole("link").length).toBeGreaterThan(0);
  });
});
