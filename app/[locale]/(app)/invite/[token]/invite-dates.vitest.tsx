// West of UTC on purpose: the bug only shows there.
process.env.TZ = "America/Chicago";

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enCommon from "@/messages/en/common.json";
import itCommon from "@/messages/it/common.json";

/**
 * The trip dates on the invite page.
 *
 * Trip dates are calendar days ("2026-11-24"), which new Date() reads as UTC
 * midnight. The page formatted them in the viewer's time zone, so anyone west
 * of UTC was shown the day before (a Nov 24-25 trip read "Nov 23, 2026 - Nov
 * 24, 2026"), and the server (UTC) and the browser rendered different text:
 * React #418 on production, 2026-09-25. It now formats in UTC like every
 * other trip date (lib/datetime formatDateRange).
 */

vi.mock("@/lib/i18n/routing", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ user: null, loading: false }) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: {} }) }));

import InviteAcceptClient from "./InviteAcceptClient";

const props = {
  invite: { token: "tok", role: "editor" as const, expiresAt: "2036-01-01T00:00:00Z", message: null },
  trip: {
    id: "trip-1",
    title: "Lisbon",
    description: null,
    coverImageUrl: null,
    startDate: "2026-11-24",
    endDate: "2026-11-25",
    durationDays: 2,
    destination: "Lisbon",
    collaboratorCount: 3,
  },
  owner: { displayName: "Ana", avatarUrl: null },
  inviter: null,
};

function renderIn(locale: string, common: object) {
  return render(
    <NextIntlClientProvider locale={locale} messages={{ common }}>
      <InviteAcceptClient {...props} />
    </NextIntlClientProvider>
  );
}

describe("invite page trip dates", () => {
  it("shows the trip's own days west of UTC, not the day before", () => {
    expect(new Date("2026-11-24").getDate()).toBe(23); // the trap, in this zone
    renderIn("en", enCommon);
    expect(screen.getByText("Nov 24-25, 2026")).toBeTruthy();
    expect(screen.queryByText(/Nov 23/)).toBeNull();
  });

  it("in the page's language, the same way My Trips shows it", () => {
    renderIn("it", itCommon);
    expect(screen.getByText("nov 24-25, 2026")).toBeTruthy();
  });
});
