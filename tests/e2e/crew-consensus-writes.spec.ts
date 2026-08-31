import { test, expect, request as pwRequest } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";

/**
 * When a crew approves a proposal, the activity must actually reach the trip.
 *
 * WHAT THIS REPRODUCES
 * --------------------
 * app/api/trips/[id]/proposals/[proposalId]/vote/route.ts applied a reached
 * consensus through the VOTER's own RLS-scoped client, and discarded both
 * write results — no error variable, no `.select()`. The next line logged
 * success and the route returned `success: true`.
 *
 * But RLS says:
 *   trips_update                          owner OR role='editor'
 *   activity_proposals_update_consolidated owner OR proposer-while-pending,
 *                                          with WITH CHECK re-testing the NEW
 *                                          row — so status='approved' is
 *                                          rejected even for the proposer
 *
 * while the route lets `voter` vote — and `voter` is the DEFAULT and
 * recommended role in the invite UI (app/api/trips/[id]/invites/route.ts:74,
 * components/collaboration/RoleSelector.tsx:66).
 *
 * So whenever the deciding vote came from anyone but the owner, BOTH writes
 * matched zero rows. PostgREST answers a zero-row UPDATE with 204 and
 * error:null. The crew saw the proposal as approved — InlineProposalCard
 * computes that client-side from the recomputed consensus — and the activity
 * was never in the itinerary. Permanently: this is the only path that inserts
 * it, so not even the owner could recover it through the UI.
 *
 * WHY IT ASSERTS ON THE DATABASE
 * ------------------------------
 * The UI showed "approved" in both the broken and the fixed world. Only
 * trips.itinerary distinguishes them.
 *
 * REQUIRES
 *   npx tsx scripts/e2e-fixtures.mts --seed
 *   BASE_URL=http://localhost:3001 npx tsx scripts/e2e-login.mts
 *   BASE_URL=http://localhost:3001 npx playwright test crew-consensus
 */

const MANIFEST = ".auth/e2e-fixtures.json";

function creds() {
  let url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  let key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if ((!url || !key) && existsSync(".env.local")) {
    for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
      if (!m) continue;
      const v = m[2].trim().replace(/^["']|["']$/g, "");
      if (m[1] === "NEXT_PUBLIC_SUPABASE_URL") url ||= v;
      if (m[1] === "SUPABASE_SERVICE_ROLE_KEY") key ||= v;
    }
  }
  return { url, key };
}

async function db() {
  const { createClient } = await import("@supabase/supabase-js");
  const { url, key } = creds();
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const manifest = existsSync(MANIFEST)
  ? JSON.parse(readFileSync(MANIFEST, "utf8"))
  : null;
const tripId: string | undefined = manifest?.tripId;

/** Activity names on day 1, straight from the row. */
async function dayOneNames(): Promise<string[]> {
  const sb = await db();
  const { data } = await sb.from("trips").select("itinerary").eq("id", tripId!).maybeSingle();
  const days = Array.isArray((data as { itinerary?: unknown })?.itinerary)
    ? ((data as { itinerary: unknown[] }).itinerary as Array<{ activities?: Array<{ name?: string }> }>)
    : [];
  return (days[0]?.activities ?? []).map((a) => a.name ?? "");
}

test.describe("crew consensus actually writes", () => {
  test.skip(!tripId, "no fixture trip — run scripts/e2e-fixtures.mts --seed");
  test.skip(!creds().url || !creds().key, "no service credentials to assert on the database");

  let snapshot: unknown = null;
  let proposalId = "";
  const ACTIVITY_NAME = "Consensus Test Rooftop Bar";

  test.beforeEach(async () => {
    const sb = await db();
    const { data } = await sb.from("trips").select("itinerary").eq("id", tripId!).maybeSingle();
    snapshot = (data as { itinerary?: unknown } | null)?.itinerary ?? null;

    // A fresh proposal, targeting day 1, proposed BY THE OWNER so the
    // proposer/owner distinction cannot accidentally rescue the write.
    await sb.from("proposal_votes").delete().eq("proposal_id", proposalId || "00000000-0000-0000-0000-000000000000");
    const { data: created, error } = await sb
      .from("activity_proposals")
      .insert({
        trip_id: tripId,
        proposed_by: manifest.users.owner.id,
        // activity_proposals_type_check allows only 'new' | 'replacement'.
        type: "new",
        status: "voting",
        target_day: 1,
        target_time_slot: "evening",
        activity_data: {
          id: "act_consensus_e2e",
          name: ACTIVITY_NAME,
          type: "activity",
          time_slot: "evening",
          start_time: "19:00",
          duration_minutes: 90,
          description: "Fixture proposal for the consensus E2E.",
          location: "Old Town",
          coordinates: { lat: 41.3874, lng: 2.1686 },
          tips: [],
          booking_required: false,
        },
      })
      .select("id")
      .single();
    if (error) throw new Error(`could not create proposal: ${error.message}`);
    proposalId = (created as { id: string }).id;
  });

  test.afterEach(async () => {
    const sb = await db();
    if (proposalId) {
      await sb.from("proposal_votes").delete().eq("proposal_id", proposalId);
      await sb.from("activity_proposals").delete().eq("id", proposalId);
    }
    if (snapshot !== null) {
      await sb.from("trips").update({ itinerary: snapshot }).eq("id", tripId!);
    }
  });

  /** Cast a vote as one fixture role, through the real HTTP route. */
  async function vote(role: "owner" | "mate" | "voter", voteType: string) {
    const ctx = await pwRequest.newContext({
      storageState: `.auth/${role}.json`,
      baseURL: process.env.BASE_URL ?? "http://localhost:3001",
    });
    const res = await ctx.post(`/api/trips/${tripId}/proposals/${proposalId}/vote`, {
      data: { voteType },
    });
    const body = await res.json().catch(() => ({}));
    await ctx.dispose();
    return { status: res.status(), body };
  }

  test("a VOTER casting the deciding vote still gets the activity added", async () => {
    // Participation needs >= 50% of 3 collaborators and score >= 1.5.
    // owner "love" (2.0) then voter "love" (2.0) = participation 0.67, score
    // 2.0 -> approved, and the approval lands inside the VOTER's request.
    const first = await vote("owner", "love");
    expect(first.status, JSON.stringify(first.body)).toBe(200);

    const deciding = await vote("voter", "love");
    expect(deciding.status, JSON.stringify(deciding.body)).toBe(200);

    // THE ASSERTION THAT MATTERS. Before the fix this was still the original
    // list: the write matched zero rows, error was null, and the route said
    // success.
    const names = await dayOneNames();
    expect(
      names,
      "the crew approved it and the route reported success, but the activity never reached the itinerary"
    ).toContain(ACTIVITY_NAME);

    // And the route must not claim more than it did.
    expect(deciding.body?.data?.activityAdded ?? deciding.body?.activityAdded).not.toBe(false);
  });

  test("the proposal is actually marked resolved, not left voting forever", async () => {
    await vote("owner", "love");
    await vote("voter", "love");

    const sb = await db();
    const { data } = await sb
      .from("activity_proposals")
      .select("status, resolved_at")
      .eq("id", proposalId)
      .maybeSingle();

    // Previously stuck at 'voting': the status write was refused by RLS for
    // every non-owner, and by WITH CHECK even for the proposer. It kept
    // accepting votes and re-running the approval branch on each one.
    expect((data as { status?: string } | null)?.status).toBe("approved");
    expect((data as { resolved_at?: string } | null)?.resolved_at).toBeTruthy();
  });

  test("the owner's own deciding vote still works (the path that always did)", async () => {
    // Guards against a fix that repaired the voter case by breaking the case
    // that was already fine.
    await vote("voter", "love");
    const deciding = await vote("owner", "love");
    expect(deciding.status).toBe(200);

    expect(await dayOneNames()).toContain(ACTIVITY_NAME);
  });

  test("an approved activity is added exactly once, however many vote after", async () => {
    await vote("owner", "love");
    await vote("voter", "love");
    // A third vote arrives after consensus. If the proposal were still open
    // (the old behaviour) this would run the approval branch again.
    await vote("mate", "love");

    const occurrences = (await dayOneNames()).filter((n) => n === ACTIVITY_NAME).length;
    expect(occurrences, "the approved activity was added more than once").toBe(1);
  });
});
