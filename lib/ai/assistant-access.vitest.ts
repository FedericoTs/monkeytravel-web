import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveAssistantRole, DATE_CHANGING_ASSISTANT_CHANGES } from "./assistant-access";

/** The owner and editors may use the trip assistant; nobody else. */

const roles: Record<string, string> = { "mate-1": "editor", "voter-1": "voter", "viewer-1": "viewer" };
const supabase = {
  from: () => {
    const filters: Record<string, unknown> = {};
    const q = {
      select: () => q,
      eq: (c: string, v: unknown) => {
        filters[c] = v;
        return q;
      },
      maybeSingle: async () => {
        const role = roles[String(filters.user_id)];
        return { data: role ? { role } : null, error: null };
      },
    };
    return q;
  },
} as unknown as SupabaseClient;

const trip = { id: "trip-1", user_id: "owner-1" };

describe("resolveAssistantRole", () => {
  it("the owner and editors may use it", async () => {
    expect(await resolveAssistantRole(supabase, trip, "owner-1")).toBe("owner");
    expect(await resolveAssistantRole(supabase, trip, "mate-1")).toBe("editor");
  });

  it("voters, viewers and strangers may not", async () => {
    for (const who of ["voter-1", "viewer-1", "stranger"]) {
      expect(await resolveAssistantRole(supabase, trip, who)).toBeNull();
    }
  });

  it("an ownerless trip belongs to nobody", async () => {
    expect(await resolveAssistantRole(supabase, { id: "t", user_id: null }, "stranger")).toBeNull();
  });
});

describe("date-changing assistant changes", () => {
  it("are exactly the ones that move start or end dates", () => {
    expect([...DATE_CHANGING_ASSISTANT_CHANGES].sort()).toEqual(["add_day", "shift_days"]);
  });
});
