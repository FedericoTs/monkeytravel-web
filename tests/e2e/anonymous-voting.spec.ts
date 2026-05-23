import { test, expect } from "@playwright/test";

/**
 * Anonymous voting on /shared/[token].
 *
 * Currently SKIPPED until the Supabase migration
 * `20260523_anonymous_activity_votes.sql` has been applied to production.
 * Once applied, set `RUN_VOTING_TESTS=1` in CI to enable.
 *
 * To run a one-off check after applying the migration:
 *   SHARE_TOKEN=<a real share token> RUN_VOTING_TESTS=1 npx playwright test anonymous-voting
 */

test.describe("anonymous voting on shared trips @prod", () => {
  test.skip(
    !process.env.RUN_VOTING_TESTS,
    "needs Supabase migration 20260523_anonymous_activity_votes.sql applied + SHARE_TOKEN env"
  );

  const SHARE_TOKEN = process.env.SHARE_TOKEN || "";

  test("GET /api/shared/[token]/votes returns initial tallies", async ({
    request,
  }) => {
    const res = await request.get(`/api/shared/${SHARE_TOKEN}/votes`);
    expect([200, 404]).toContain(res.status());
    if (res.status() === 200) {
      const body = await res.json();
      expect(body).toHaveProperty("tallies");
      expect(body).toHaveProperty("myVotes");
    }
  });

  test("POST /api/shared/[token]/vote casts a thumbs-up", async ({
    request,
  }) => {
    // Use an activity_id that exists in the shared trip — caller must
    // ensure this. For a smoke test, "test-activity-1" is fine: the API
    // accepts any string and upserts; the UI just won't display it.
    const res = await request.post(`/api/shared/${SHARE_TOKEN}/vote`, {
      data: {
        activity_id: "test-activity-e2e-" + Date.now(),
        vote_type: "up",
        display_name: "E2E Bot",
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.up).toBeGreaterThanOrEqual(1);
    expect(body.myVote).toBe("up");
  });

  test("re-voting with vote_type:null removes the vote", async ({
    request,
  }) => {
    const activityId = "test-activity-e2e-toggle-" + Date.now();
    // Cast then remove
    const up = await request.post(`/api/shared/${SHARE_TOKEN}/vote`, {
      data: { activity_id: activityId, vote_type: "up" },
    });
    expect(up.status()).toBe(200);

    const remove = await request.post(`/api/shared/${SHARE_TOKEN}/vote`, {
      data: { activity_id: activityId, vote_type: null },
    });
    expect(remove.status()).toBe(200);
    const body = await remove.json();
    expect(body.up).toBe(0);
    expect(body.myVote).toBeNull();
  });

  test("invalid share token returns 404", async ({ request }) => {
    const res = await request.post("/api/shared/00000000-0000-0000-0000-000000000000/vote", {
      data: { activity_id: "x", vote_type: "up" },
    });
    expect(res.status()).toBe(404);
  });
});
