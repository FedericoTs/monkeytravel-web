// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Removing an avatar. The file sits in a public bucket, so the avatar is only
 * gone once the file is: a profile read or a file removal that fails clears
 * nothing and says so, rather than reporting a deletion that didn't happen.
 */

let profileRead: { data: unknown; error: unknown };
let removal: { error: unknown };
const removed: string[][] = [];
const updates: unknown[] = [];

const supabase = {
  from: () => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      single: async () => profileRead,
      update: (value: unknown) => {
        updates.push(value);
        return { eq: async () => ({ error: null }) };
      },
    };
    return chain;
  },
  storage: {
    from: () => ({
      remove: async (paths: string[]) => {
        removed.push(paths);
        return removal;
      },
    }),
  },
};
vi.mock("@/lib/api/auth", () => ({
  getAuthenticatedUser: async () => ({ user: { id: "u1" }, supabase, errorResponse: null }),
}));

const URL_ON_FILE = "https://cdn.example.com/storage/v1/object/public/avatars/u1/avatar-1.jpg";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  profileRead = { data: { avatar_url: URL_ON_FILE }, error: null };
  removal = { error: null };
  removed.length = 0;
  updates.length = 0;
});

describe("DELETE /api/profile/avatar", () => {
  it("removes the file, then clears the avatar", async () => {
    const { DELETE } = await import("./route");
    expect((await DELETE()).status).toBe(200);
    expect(removed).toEqual([["u1/avatar-1.jpg"]]);
    expect(updates).toEqual([expect.objectContaining({ avatar_url: null })]);
  });

  it("clears nothing when the profile can't be read", async () => {
    profileRead = { data: null, error: { message: "timeout" } };
    const { DELETE } = await import("./route");
    expect((await DELETE()).status).toBe(500);
    expect(removed).toEqual([]);
    expect(updates).toEqual([]);
  });

  it("clears nothing when the file can't be removed", async () => {
    removal = { error: { message: "storage unavailable" } };
    const { DELETE } = await import("./route");
    expect((await DELETE()).status).toBe(500);
    expect(updates).toEqual([]);
  });
});
