/** @vitest-environment node */
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Keeping a plan answers its token and a key, and stores only the key's hash;
 * the key is what changes it, and every miss is the same 404.
 */

vi.mock("@/lib/api/rate-limit", () => ({
  createRateLimiter: () => ({ check: async () => ({ allowed: true, remaining: 1 }) }),
}));

type Row = Record<string, unknown> & { token: string; opens: number };
const rows = new Map<string, Row>();

const fakeAdmin = {
  from(table: string) {
    if (table !== "kept_plans") throw new Error(`unexpected table ${table}`);
    return {
      insert(row: Record<string, unknown>) {
        return {
          select: () => ({
            single: async () => {
              const stored: Row = { ...row, token: String(row.token), opens: 0, expires_at: "2026-12-01T00:00:00.000Z" };
              rows.set(stored.token, stored);
              return { data: { expires_at: stored.expires_at }, error: null };
            },
          }),
        };
      },
      update(patch: Record<string, unknown>) {
        const filters: Array<(r: Row) => boolean> = [];
        const chain = {
          eq: (col: string, val: unknown) => (filters.push((r) => r[col] === val), chain),
          gt: (col: string, val: string) => (filters.push((r) => String(r[col]) > val), chain),
          select: () => chain,
          maybeSingle: async () => {
            const match = [...rows.values()].find((r) => filters.every((f) => f(r)));
            if (!match) return { data: null, error: null };
            Object.assign(match, patch);
            return { data: { expires_at: match.expires_at }, error: null };
          },
        };
        return chain;
      },
    };
  },
  async rpc(fn: string, args: { p_token: string }) {
    if (fn !== "open_kept_plan") throw new Error(`unexpected rpc ${fn}`);
    const row = rows.get(args.p_token);
    if (!row) return { data: null, error: null };
    row.opens += 1;
    return { data: { plan: row.plan, expires_at: row.expires_at }, error: null };
  },
};
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => fakeAdmin }));

const { POST } = await import("./route");
const { GET, PUT } = await import("./[token]/route");

const plan = {
  destination: "Lisbon, Portugal",
  startDate: "2027-03-15",
  endDate: "2027-03-16",
  itinerary: {
    destination: { name: "Lisbon", country: "Portugal", description: "", best_for: [], weather_note: "" },
    days: [{ day_number: 1, activities: [{ name: "Belém Tower" }] }, { day_number: 2, activities: [] }],
    trip_summary: { total_estimated_cost: 300, currency: "EUR", highlights: [], packing_suggestions: [] },
  },
};

const base = "https://monkeytravel.app/api/plans";
const keep = (body: unknown) =>
  POST(new NextRequest(base, { method: "POST", body: JSON.stringify(body), headers: { cookie: "mt_session_id=s1" } }));
const params = (token: string) => ({ params: Promise.resolve({ token }) });
const open = (token: string) => GET(new NextRequest(`${base}/${token}`), params(token));
const change = (token: string, key: string | null, body: unknown) =>
  PUT(
    new NextRequest(`${base}/${token}`, {
      method: "PUT",
      body: JSON.stringify(body),
      headers: key ? { "x-plan-key": key } : {},
    }),
    params(token)
  );

beforeEach(() => rows.clear());

describe("POST /api/plans", () => {
  it("keeps a plan and stores the key only as its hash", async () => {
    const res = await keep({ plan });
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const { token, key, expiresAt } = await res.json();
    expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(expiresAt).toBe("2026-12-01T00:00:00.000Z");
    const row = rows.get(token)!;
    expect(row.key_hash).toBe(createHash("sha256").update(key).digest("hex"));
    expect(JSON.stringify(row)).not.toContain(key);
    expect(row.session_id).toBe("s1");
  });

  it("refuses what is not a plan, and a body too large to keep", async () => {
    expect((await keep({ plan: { destination: "Lisbon" } })).status).toBe(400);
    expect((await keep({ plan: { ...plan, filler: "x".repeat(300 * 1024) } })).status).toBe(400);
    expect(rows.size).toBe(0);
  });
});

describe("GET and PUT /api/plans/<token>", () => {
  it("opens a kept plan and counts the open", async () => {
    const { token } = await (await keep({ plan })).json();
    const res = await open(token);
    expect(res.status).toBe(200);
    expect((await res.json()).plan.destination).toBe("Lisbon, Portugal");
    expect(rows.get(token)!.opens).toBe(1);
  });

  it("changes the plan only with its key", async () => {
    const { token, key } = await (await keep({ plan })).json();
    const changed = { ...plan, endDate: "2027-03-17" };
    expect((await change(token, "wrong-key", { plan: changed })).status).toBe(404);
    expect((await change(token, null, { plan: changed })).status).toBe(404);
    expect((rows.get(token)!.plan as { endDate: string }).endDate).toBe("2027-03-16");
    expect((await change(token, key, { plan: changed })).status).toBe(200);
    expect((rows.get(token)!.plan as { endDate: string }).endDate).toBe("2027-03-17");
  });

  it("answers every miss the same way", async () => {
    expect((await open("AbCdEfGhIjKlMnOpQrSt_-")).status).toBe(404);
    expect((await open("not-a-token")).status).toBe(404);
    expect((await change("not-a-token", "k", { plan })).status).toBe(404);
  });
});
