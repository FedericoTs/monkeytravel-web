// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { readCreditReading } from "@/lib/ops/gemini-credit";

const s = vi.hoisted(() => ({ admin: true }));

vi.mock("@/lib/api/auth", () => ({
  getAuthenticatedAdmin: async () => ({
    errorResponse: s.admin ? null : Response.json({ error: "Forbidden" }, { status: 403 }),
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

const { POST } = await import("./route");

const post = (body: string) =>
  POST(new NextRequest("https://monkeytravel.app/api/admin/costs/credit", { method: "POST", body }));

beforeEach(() => {
  s.admin = true;
  delete (globalThis as { __geminiCreditReading?: unknown }).__geminiCreditReading;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-06T09:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("typing the Gemini balance", () => {
  it("keeps the balance with the time it was typed", async () => {
    const res = await post(JSON.stringify({ usd: 42.5 }));
    expect(res.status).toBe(200);
    expect(await readCreditReading()).toEqual({ usd: 42.5, at: "2026-11-06T09:00:00.000Z" });
  });

  it("takes an empty balance", async () => {
    expect((await post(JSON.stringify({ usd: 0 }))).status).toBe(200);
    expect(await readCreditReading()).toMatchObject({ usd: 0 });
  });

  it("is for admins", async () => {
    s.admin = false;
    expect((await post(JSON.stringify({ usd: 42.5 }))).status).toBe(403);
    expect(await readCreditReading()).toBeNull();
  });

  it.each([
    ["nothing", "{}"],
    ["text", JSON.stringify({ usd: "42.5" })],
    ["below zero", JSON.stringify({ usd: -1 })],
    ["more than Google sells at once", JSON.stringify({ usd: 5000.01 })],
    ["null", JSON.stringify({ usd: null })],
    ["a body that isn't JSON", "42.5{"],
  ])("refuses %s", async (_name, body) => {
    expect((await post(body)).status).toBe(400);
    expect(await readCreditReading()).toBeNull();
  });

  it("takes the most Google sells at once", async () => {
    expect((await post(JSON.stringify({ usd: 5000 }))).status).toBe(200);
  });
});
