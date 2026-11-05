// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fakeSupabase } from "@/tests/fake-supabase";

/**
 * What a generation knows about who asks: the language to write in and the
 * profile's preferences. Neither can stop a plan being written, so a profile
 * that can't be read gives the defaults.
 */

let cookie: string | undefined;
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "NEXT_LOCALE" && cookie ? { value: cookie } : undefined) }),
}));

const { loadUserContext } = await import("./user-context");

const signedIn = (row: Record<string, unknown>) => {
  const db = fakeSupabase(() => ({ data: row, error: null }));
  return { db, context: loadUserContext(db.client as unknown as SupabaseClient, "u1") };
};
const unreadable = () => {
  const db = fakeSupabase(() => ({ data: null, error: { message: "read failed" } }));
  return loadUserContext(db.client as unknown as SupabaseClient, "u1");
};

beforeEach(() => {
  cookie = undefined;
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("the language to write in", () => {
  it("is the locale cookie's before the profile's", async () => {
    cookie = "it";
    expect((await signedIn({ preferred_language: "es" }).context).userLanguage).toBe("it");
  });

  it("is the profile's without a cookie, a regional tag by its base language", async () => {
    expect((await signedIn({ preferred_language: "es" }).context).userLanguage).toBe("es");
    expect((await signedIn({ preferred_language: "pt-BR" }).context).userLanguage).toBe("pt");
  });

  it("is English when nothing names a language the app has", async () => {
    cookie = "de";
    expect((await signedIn({ preferred_language: "fr" }).context).userLanguage).toBe("en");
    expect((await signedIn({}).context).userLanguage).toBe("en");
  });

  it("is the cookie's alone for a visitor, with no profile read", async () => {
    cookie = "pt-PT";
    const db = fakeSupabase();
    const { userLanguage } = await loadUserContext(db.client as unknown as SupabaseClient, null);
    expect(userLanguage).toBe("pt");
    expect(db.log).toEqual([]);
  });

  it("is still the cookie's when the profile can't be read", async () => {
    cookie = "es";
    expect((await unreadable()).userLanguage).toBe("es");
    cookie = undefined;
    expect((await unreadable()).userLanguage).toBe("en");
  });
});

describe("the profile's preferences", () => {
  it("come from one read of the profile", async () => {
    const { db, context } = signedIn({
      preferences: { dietaryPreferences: ["vegan"], travelStyles: ["adventure"], accessibilityNeeds: ["wheelchair"] },
    });
    expect((await context).profilePreferences).toEqual({
      dietaryPreferences: ["vegan"],
      travelStyles: ["adventure"],
      accessibilityNeeds: ["wheelchair"],
    });
    expect(db.log).toHaveLength(1);
    expect(db.log[0]).toMatchObject({ table: "users", filters: [["eq", "id", "u1"]] });
  });

  it("turn quiet hours into the hours the plan can use", async () => {
    const { context } = signedIn({ notification_settings: { quietHoursStart: 22, quietHoursEnd: 7 } });
    expect((await context).profilePreferences).toEqual({ activeHoursStart: 7, activeHoursEnd: 22 });
  });

  it("ignore quiet hours that are only half set", async () => {
    const { context } = signedIn({ notification_settings: { quietHoursStart: 22 } });
    expect((await context).profilePreferences).toEqual({});
  });

  it("are empty when the profile can't be read", async () => {
    expect((await unreadable()).profilePreferences).toEqual({});
  });
});
