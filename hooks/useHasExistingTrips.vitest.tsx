/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

/**
 * The welcome-back banner on step 1. The server page already counted the
 * trips of the user it rendered for; the browser used to count them again
 * (2-3 times, once per auth event), so it now counts only for someone else.
 */

const counted: string[] = [];
let tripCount = 0;
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: (_column: string, userId: string) => {
          counted.push(userId);
          return Promise.resolve({ count: tripCount, error: null });
        },
      }),
    }),
  }),
}));

const { useHasExistingTrips } = await import("./useHasExistingTrips");

type Props = { authLoading: boolean; userId: string | null; server: { userId: string | null; hasTrips: boolean } };
const render = (initialProps: Props) =>
  renderHook((p: Props) => useHasExistingTrips(p.authLoading, p.userId, p.server), { initialProps });

beforeEach(() => {
  counted.length = 0;
  tripCount = 0;
});

describe("useHasExistingTrips", () => {
  it("takes the server's answer for the user it rendered for, without asking again", async () => {
    const server = { userId: "me", hasTrips: true };
    const hook = render({ authLoading: true, userId: null, server });
    expect(hook.result.current).toBe(true);
    // Auth resolves, then reports the same user again as a new object.
    hook.rerender({ authLoading: false, userId: "me", server });
    hook.rerender({ authLoading: false, userId: "me", server: { ...server } });
    await Promise.resolve();
    expect(hook.result.current).toBe(true);
    expect(counted).toEqual([]);
  });

  it("asks for a user the server did not count, e.g. one who signed in on the page", async () => {
    tripCount = 2;
    const hook = render({ authLoading: false, userId: "me", server: { userId: null, hasTrips: false } });
    await waitFor(() => expect(hook.result.current).toBe(true));
    expect(counted).toEqual(["me"]);
  });

  it("asks once per user, not once per auth event", async () => {
    const server = { userId: null, hasTrips: false };
    const hook = render({ authLoading: false, userId: "other", server });
    hook.rerender({ authLoading: false, userId: "other", server: { ...server } });
    await waitFor(() => expect(counted).toEqual(["other"]));
  });

  it("hides the banner when nobody is signed in", async () => {
    const hook = render({ authLoading: false, userId: null, server: { userId: "me", hasTrips: true } });
    await waitFor(() => expect(hook.result.current).toBe(false));
    expect(counted).toEqual([]);
  });
});
