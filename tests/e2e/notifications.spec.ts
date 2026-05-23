import { test, expect } from "@playwright/test";

/**
 * Notifications scaffold — public surface area checks.
 *
 * The bell + service mostly need authenticated state to demonstrate end-
 * to-end, which requires a test user that we don't currently seed here.
 * What we CAN check without auth:
 *   - GET /api/notifications for an anonymous caller returns
 *     `{ notifications: [], unreadCount: 0 }` and 200 — not 401. The bell
 *     UI relies on this to mount unconditionally.
 *   - POST mutation paths refuse anonymous callers (401), since fabricating
 *     a "mark all read" without auth would be pointless and noisy.
 *   - PATCH single notification refuses anonymous callers (401).
 *   - Bad action strings return 400, not 500.
 *
 * Authenticated bell/dropdown rendering belongs in a follow-up test that
 * seeds a fixture user; for now we lock down the API contract.
 */

test.describe("Notifications API — anonymous contract @prod", () => {
  test("GET /api/notifications returns empty list for anonymous callers", async ({
    request,
  }) => {
    const res = await request.get("/api/notifications");
    expect(res.status()).toBe(200);
    const body = await res.json();
    // apiSuccess may wrap as { data: ... } or pass through; accept both.
    const payload = body?.data ?? body;
    expect(payload).toHaveProperty("notifications");
    expect(payload).toHaveProperty("unreadCount");
    expect(Array.isArray(payload.notifications)).toBe(true);
    expect(payload.notifications.length).toBe(0);
    expect(payload.unreadCount).toBe(0);
  });

  test("POST /api/notifications mark_all_read requires auth", async ({
    request,
  }) => {
    const res = await request.post("/api/notifications", {
      data: { action: "mark_all_read" },
    });
    expect(res.status()).toBe(401);
  });

  test("POST /api/notifications rejects unknown action with 400", async ({
    request,
  }) => {
    const res = await request.post("/api/notifications", {
      data: { action: "delete_universe" },
    });
    // 400 because action validation runs before the auth check fires; if
    // that ordering ever flips this still passes via 401, which is also
    // acceptable (auth before validation is fine).
    expect([400, 401]).toContain(res.status());
  });

  test("PATCH /api/notifications/[id] requires auth", async ({ request }) => {
    const res = await request.fetch(
      "/api/notifications/00000000-0000-0000-0000-000000000000",
      {
        method: "PATCH",
        data: { action: "mark_read" },
      }
    );
    expect(res.status()).toBe(401);
  });
});
