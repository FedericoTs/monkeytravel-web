// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Before the trip assistant does any work, a turn passes these checks in
 * order: a signed-in caller, a trip id and a message, the AI kill switch, the
 * daily limit, a trip the caller may edit. The reply's language is the trip's
 * own, else the visitor's (the locale cookie, then the profile).
 */

const state = {
  authed: true,
  cookie: undefined as string | undefined,
  profile: null as string | null,
  allowed: true,
  underLimit: true,
  trip: "ok" as "ok" | "missing",
  role: "owner" as "owner" | null,
  tripLocale: undefined as string | undefined,
};
const reads: string[] = [];
const blockedCall = vi.fn(async () => Response.json({ error: "off" }, { status: 503 }));
const checkUsageLimit = vi.fn(async () =>
  state.underLimit ? { allowed: true, used: 1, limit: 10 } : { allowed: false, used: 10, limit: 10, message: "Daily limit" }
);

vi.mock("@/lib/api-gateway", () => ({
  checkApiAccess: async () => (state.allowed ? { allowed: true } : { allowed: false, message: "AI is off" }),
  blockedCall: (...args: unknown[]) => blockedCall(...(args as [])),
}));
vi.mock("@/lib/usage-limits", () => ({ checkUsageLimit: (...args: unknown[]) => checkUsageLimit(...(args as [])) }));
vi.mock("@/lib/ai/assistant-access", () => ({ resolveAssistantRole: async () => state.role, ASSISTANT_FORBIDDEN_MESSAGE: "Not yours" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "NEXT_LOCALE" && state.cookie ? { value: state.cookie } : undefined) }),
}));

function fakeSupabase() {
  return {
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq"]) chain[m] = () => chain;
      chain.single = async () => {
        reads.push(table);
        if (table === "users") return { data: state.profile ? { preferred_language: state.profile } : null, error: null };
        if (state.trip === "missing") return { data: null, error: { code: "PGRST116", message: "no rows" } };
        return { data: { id: "trip-1", user_id: "user-1", trip_meta: state.tripLocale ? { locale: state.tripLocale } : {} }, error: null };
      };
      return chain;
    },
  };
}
vi.mock("@/lib/api/auth", () => ({
  getAuthenticatedUser: async () =>
    state.authed
      ? { user: { id: "user-1", email: "owner@example.com" }, supabase: fakeSupabase(), errorResponse: null }
      : { user: null, supabase: fakeSupabase(), errorResponse: Response.json({ error: "Sign in" }, { status: 401 }) },
}));

const { readAssistantTurn } = await import("./turn");

const ask = (body: unknown) =>
  readAssistantTurn(new NextRequest("http://localhost/api/ai/assistant", { method: "POST", body: JSON.stringify(body) }), 1000);
const refusal = async (turn: Awaited<ReturnType<typeof ask>>) => {
  if (!turn.refused) throw new Error("expected a refusal");
  return { status: turn.refused.status, json: await turn.refused.json() };
};
const turnFor = { tripId: "trip-1", message: "Make day 2 cheaper" };

beforeEach(() => {
  Object.assign(state, { authed: true, cookie: undefined, profile: null, allowed: true, underLimit: true, trip: "ok", role: "owner", tripLocale: undefined });
  reads.length = 0;
  blockedCall.mockClear();
  checkUsageLimit.mockClear();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("an assistant turn is refused", () => {
  it("when nobody is signed in, before anything is read", async () => {
    state.authed = false;
    expect((await refusal(await ask(turnFor))).status).toBe(401);
    expect(reads).toEqual([]);
  });

  it("without a trip id or a message", async () => {
    for (const body of [{ message: "hi" }, { tripId: "trip-1" }, { tripId: "trip-1", message: "" }]) {
      const { status, json } = await refusal(await ask(body));
      expect(status).toBe(400);
      expect(JSON.stringify(json)).toContain("Missing tripId or message");
    }
    expect(checkUsageLimit).not.toHaveBeenCalled();
  });

  it("while the AI is switched off, logged as a blocked call for this trip", async () => {
    state.allowed = false;
    expect((await refusal(await ask(turnFor))).status).toBe(503);
    expect(blockedCall).toHaveBeenCalledWith(
      { allowed: false, message: "AI is off" },
      expect.objectContaining({ endpoint: "/api/ai/assistant", startTime: 1000, metadata: { user_id: "user-1", trip_id: "trip-1" } })
    );
    expect(checkUsageLimit).not.toHaveBeenCalled();
  });

  it("past the daily limit, with the usage it was counted against", async () => {
    state.underLimit = false;
    const { status, json } = await refusal(await ask(turnFor));
    expect(status).toBe(429);
    expect(JSON.stringify(json)).toContain("Daily limit");
    expect(reads).not.toContain("trips");
  });

  it("for a trip the caller cannot see, or may not edit", async () => {
    state.trip = "missing";
    expect((await refusal(await ask(turnFor))).status).toBe(404);
    state.trip = "ok";
    state.role = null;
    const { status, json } = await refusal(await ask(turnFor));
    expect(status).toBe(403);
    expect(JSON.stringify(json)).toContain("NOT_ALLOWED");
  });
});

describe("an assistant turn's language", () => {
  const language = async () => {
    const turn = await ask(turnFor);
    if (turn.refused) throw new Error("refused");
    return turn.userLanguage;
  };

  it("is the trip's own when the trip has one", async () => {
    Object.assign(state, { cookie: "it", profile: "es", tripLocale: "pt" });
    expect(await language()).toBe("pt");
  });

  it("is the visitor's otherwise: the locale cookie, then the profile, then English", async () => {
    Object.assign(state, { cookie: "it", profile: "es" });
    expect(await language()).toBe("it");
    state.cookie = undefined;
    expect(await language()).toBe("es");
    state.profile = null;
    expect(await language()).toBe("en");
  });

  it("takes a regional tag by its base language, from the cookie or the profile", async () => {
    Object.assign(state, { cookie: "pt-BR", profile: "es" });
    expect(await language()).toBe("pt");
    Object.assign(state, { cookie: undefined, profile: "es-419" });
    expect(await language()).toBe("es");
  });
});
