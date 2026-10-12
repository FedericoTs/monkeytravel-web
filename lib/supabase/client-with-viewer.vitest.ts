/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * createClientWithViewer() lets a page start its queries before the auth
 * server has answered: the id comes from the session cookie at once, and the
 * verification of that same token runs alongside.
 */

const tokenFor = (sub: string) =>
  `h.${Buffer.from(JSON.stringify({ sub })).toString("base64url")}.sig`;

let session: { access_token: string } | null;
let getUser: (jwt?: string) => Promise<{ data: { user: { id: string } | null }; error?: unknown }>;
const getUserCalls: Array<string | undefined> = [];

vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getSession: async () => ({ data: { session } }),
      getUser: (jwt?: string) => {
        getUserCalls.push(jwt);
        return getUser(jwt);
      },
    },
  }),
}));

const { createClientWithViewer } = await import("./server");

beforeEach(() => {
  session = { access_token: tokenFor("user-1") };
  getUser = async () => ({ data: { user: { id: "user-1" } } });
  getUserCalls.length = 0;
});

describe("createClientWithViewer", () => {
  it("has the cookie's user id before the auth server answers", async () => {
    getUser = () => new Promise(() => {}); // never answers
    const { claimedId } = await createClientWithViewer();
    expect(claimedId).toBe("user-1");
  });

  it("verifies that same token with the auth server", async () => {
    const { verified } = await createClientWithViewer();
    expect(await verified).toEqual({ id: "user-1" });
    expect(getUserCalls).toEqual([session!.access_token]);
  });

  it("without a session there is no id and no call to the auth server", async () => {
    session = null;
    const { claimedId, verified } = await createClientWithViewer();
    expect(claimedId).toBeNull();
    expect(await verified).toBeNull();
    expect(getUserCalls).toEqual([]);
  });

  it("a token the auth server rejects, or an auth server that fails, verifies nobody", async () => {
    getUser = async () => ({ data: { user: null }, error: { status: 403 } });
    expect(await (await createClientWithViewer()).verified).toBeNull();
    getUser = async () => Promise.reject(new TypeError("fetch failed"));
    expect(await (await createClientWithViewer()).verified).toBeNull();
  });
});
