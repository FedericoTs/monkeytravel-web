import { afterEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ email: null as string | null }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: session.email ? { id: "u1", email: session.email } : null } }) },
  }),
}));

import { GET } from "./route";

afterEach(() => vi.unstubAllEnvs());

describe("GET /api/auth/admin", () => {
  it("says yes to an admin and no to anyone else, without caching", async () => {
    vi.stubEnv("ADMIN_EMAILS", "Ada <ada@example.com>");
    session.email = "ada@example.com";
    const yes = await GET();
    expect(await yes.json()).toEqual({ admin: true });
    expect(yes.headers.get("Cache-Control")).toBe("private, no-store");

    session.email = "guest@example.com";
    expect(await (await GET()).json()).toEqual({ admin: false });

    session.email = null;
    expect(await (await GET()).json()).toEqual({ admin: false });
  });
});
