import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

/**
 * Returning travellers with an unfinished profile were asked to finish it 1.5 s
 * into whatever page they opened, the planner and their saved trip included,
 * where the trip asks its own questions. The profile is not asked for over
 * those pages any more.
 */

let path = "/trips";
vi.mock("next/navigation", () => ({ usePathname: () => path }));
vi.mock("next/dynamic", () => ({
  default: () =>
    function StubModal(props: { isOpen: boolean }) {
      return props.isOpen ? <div data-testid="profile-modal" /> : null;
    },
}));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ user: { id: "u1" }, loading: false }) }));
vi.mock("@/lib/safe-storage", () => ({ safeGet: () => null }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ single: async () => ({ data: { login_count: 3, profile_completed: false }, error: null }) }),
      }),
    }),
  }),
}));

import ProfileCompletionProvider from "./ProfileCompletionProvider";

async function openAt(pathname: string) {
  path = pathname;
  render(<ProfileCompletionProvider>page</ProfileCompletionProvider>);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
  return screen.queryByTestId("profile-modal");
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("asking a returning traveller to finish their profile", () => {
  it("happens on their trips list", async () => {
    expect(await openAt("/trips")).not.toBeNull();
  });

  it.each(["/trips/abc-123", "/es/trips/abc-123", "/trips/new", "/it/trips/abc-123/day/2"])("never over %s", async (page) => {
    expect(await openAt(page)).toBeNull();
  });
});
