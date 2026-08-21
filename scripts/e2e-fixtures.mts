/**
 * E2E fixture provisioner — throwaway accounts + a fully populated group trip.
 *
 * WHY THIS EXISTS
 * ---------------
 * The collaborative surfaces have almost no production data (measured
 * 2026-08-20: 346 trips but ONE trip_collaborators row, zero activity votes,
 * zero proposals, zero expense splits, zero payment handles). So the code paths
 * that the public.users lockdown touched — collaborator lists, vote
 * attribution, Settle Up — cannot be exercised against real data at all. They
 * have to be manufactured.
 *
 * That matters because every one of those paths fails SILENTLY under a wrong
 * RLS policy: a denied read returns zero rows and a denied PostgREST embed
 * returns null, so the regression renders as "everyone is called Unknown"
 * rather than an error.
 *
 * THIS WRITES TO PRODUCTION
 * -------------------------
 * There is no separate database. .env.local points at the same Supabase
 * project as the deployed app, so these rows land in prod. Mitigations, all
 * deliberate:
 *
 *   - Emails are `mt-e2e+test-<role>@test.local`, which matches BOTH exclusion
 *     rules already in app/api/cron/sync-resend-audience (`@test.local` and
 *     `+test`), so the fixtures never reach the Resend marketing audience.
 *     `.local` is also non-routable, so nothing is deliverable even by mistake.
 *   - email_confirm: true, so Supabase sends no confirmation mail.
 *   - show_on_leaderboard is forced false — the real leaderboard has 447
 *     opt-ins and fixtures must not appear in it.
 *   - every notification_settings flag is false, marketingNotifications
 *     explicitly so.
 *   - the trip stays visibility='private' (the column default), so it cannot
 *     surface in /explore, sitemaps, or creator pages.
 *
 * They still count toward the users table and any signup analytics. Run
 * `--teardown` when finished.
 *
 * USAGE
 *   npx tsx scripts/e2e-fixtures.mts --seed        # create, write .auth/e2e-fixtures.json
 *   npx tsx scripts/e2e-fixtures.mts --status      # what exists right now
 *   npx tsx scripts/e2e-fixtures.mts --teardown    # remove all of it
 *
 * Passwords are generated per run and written only to .auth/, which carries its
 * own .gitignore. They are never printed in full and never committed.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const AUTH_DIR = join(ROOT, ".auth");
const MANIFEST = join(AUTH_DIR, "e2e-fixtures.json");

/**
 * Read a key from .env.local. Same tolerant parser as scripts/rls-baseline.mts
 * — this repo has a variable declared with a trailing space in its NAME, which
 * a `^NAME=` match silently misses.
 */
function env(name: string): string {
  const file = join(ROOT, ".env.local");
  if (!existsSync(file)) throw new Error(".env.local not found");
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (m && m[1] === name) return m[2].trim().replace(/^["']|["']$/g, "");
  }
  throw new Error(`${name} missing from .env.local`);
}

/** Matches BOTH `@test.local` and `+test` in the sync-resend-audience skip list. */
const EMAIL_FOR = (role: string) => `mt-e2e+test-${role}@test.local`;

const ROLES = [
  { key: "owner", name: "E2E Owner", role: "owner" },
  { key: "mate", name: "E2E Mate", role: "editor" },
  { key: "voter", name: "E2E Voter", role: "voter" },
] as const;

const TRIP_TITLE = "E2E Fixture Trip (safe to delete)";

/** Activity ids are explicit so vote rows line up with what the UI renders
 *  (EditableActivityCard uses `activity.id || activity-${index}`). */
const ACTIVITIES = [
  { id: "e2e-act-1", name: "Fixture Museum Visit", type: "culture" },
  { id: "e2e-act-2", name: "Fixture Riverside Walk", type: "outdoor" },
];

function itinerary(startISO: string) {
  return [
    {
      day_number: 1,
      date: startISO,
      theme: "Fixture Day",
      activities: ACTIVITIES.map((a) => ({
        ...a,
        location: "Fixture City",
        address: "1 Fixture Street, Fixture City",
        tips: ["This trip is an automated test fixture."],
      })),
    },
  ];
}

function admin(): SupabaseClient {
  return createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function findUserByEmail(db: SupabaseClient, email: string) {
  // listUsers is paginated; the fixture set is tiny but the table is not, so
  // page until found rather than assuming page 1.
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (hit) return hit;
    if (data.users.length < 200) return null;
  }
  return null;
}

async function seed() {
  const db = admin();
  mkdirSync(AUTH_DIR, { recursive: true });
  // Self-ignoring directory: avoids editing the repo's root .gitignore.
  writeFileSync(join(AUTH_DIR, ".gitignore"), "*\n", "utf8");

  const users: Record<string, { id: string; email: string; password: string; name: string }> = {};

  for (const r of ROLES) {
    const email = EMAIL_FOR(r.key);
    const password = `E2e!${randomBytes(18).toString("base64url")}`;

    let existing = await findUserByEmail(db, email);
    if (existing) {
      // Rotate the password so the manifest is always usable, even if a prior
      // run's manifest was lost.
      const { error } = await db.auth.admin.updateUserById(existing.id, { password });
      if (error) throw new Error(`password rotate failed for ${email}: ${error.message}`);
      console.log(`  reused  ${email}`);
    } else {
      const { data, error } = await db.auth.admin.createUser({
        email,
        password,
        email_confirm: true, // suppresses the confirmation email
        user_metadata: { full_name: r.name },
      });
      if (error) throw new Error(`createUser failed for ${email}: ${error.message}`);
      existing = data.user;
      console.log(`  created ${email}`);
    }

    users[r.key] = { id: existing!.id, email, password, name: r.name };
  }

  // handle_new_user (SECURITY DEFINER on auth.users) creates the public.users
  // row. Force the fields that keep fixtures out of user-facing surfaces.
  for (const r of ROLES) {
    const u = users[r.key];
    const { error } = await db
      .from("users")
      .update({
        display_name: r.name,
        show_on_leaderboard: false, // real leaderboard has 447 opt-ins
        notification_settings: {
          dealAlerts: false,
          tripReminders: false,
          pushNotifications: false,
          emailNotifications: false,
          socialNotifications: false,
          marketingNotifications: false, // the reliable opt-out signal
        },
        // Only the creditor needs handles — this is what /api/trips/[id]/
        // settlements reads with the service client (48013fc).
        ...(r.key === "owner"
          ? { paypal_handle: "e2e-fixture", venmo_handle: "e2e-fixture", wise_handle: "e2e-fixture" }
          : {}),
      })
      .eq("id", u.id);
    if (error) throw new Error(`profile update failed for ${u.email}: ${error.message}`);
  }

  // ---- the trip -----------------------------------------------------------
  const today = new Date().toISOString().slice(0, 10);
  const { data: existingTrip } = await db
    .from("trips")
    .select("id")
    .eq("user_id", users.owner.id)
    .eq("title", TRIP_TITLE)
    .maybeSingle();

  let tripId = existingTrip?.id as string | undefined;
  if (!tripId) {
    tripId = randomUUID();
    const { error } = await db.from("trips").insert({
      id: tripId,
      user_id: users.owner.id,
      title: TRIP_TITLE,
      description: "Automated E2E fixture. Safe to delete.",
      start_date: today,
      end_date: today,
      status: "planning",
      visibility: "private", // never surfaces in /explore
      itinerary: itinerary(today),
      trip_meta: { destination: "Fixture City", e2e_fixture: true },
    });
    if (error) throw new Error(`trip insert failed: ${error.message}`);
  }
  console.log(`  trip    ${tripId}`);

  // ---- membership ---------------------------------------------------------
  for (const r of ROLES) {
    const { error } = await db.from("trip_collaborators").upsert(
      { trip_id: tripId, user_id: users[r.key].id, role: r.role },
      { onConflict: "trip_id,user_id" }
    );
    if (error) throw new Error(`collaborator upsert failed (${r.key}): ${error.message}`);
  }

  // ---- activity votes: the PostgREST-embed path (activities/[id]/vote) -----
  await db.from("activity_votes").delete().eq("trip_id", tripId);
  const voteTypes = ["love", "flexible", "concerns"] as const;
  const votes = ROLES.map((r, i) => ({
    trip_id: tripId,
    activity_id: ACTIVITIES[0].id,
    user_id: users[r.key].id,
    vote_type: voteTypes[i],
  }));
  {
    const { error } = await db.from("activity_votes").insert(votes);
    if (error) throw new Error(`activity_votes insert failed: ${error.message}`);
  }

  // ---- proposal + proposal votes: the other three embed call sites ---------
  await db.from("activity_proposals").delete().eq("trip_id", tripId);
  const proposalId = randomUUID();
  {
    const { error } = await db.from("activity_proposals").insert({
      id: proposalId,
      trip_id: tripId,
      proposed_by: users.mate.id,
      type: "new",
      target_day: 1,
      status: "voting",
      activity_data: { name: "Fixture Proposed Activity", type: "food" },
    });
    if (error) throw new Error(`proposal insert failed: ${error.message}`);
  }
  {
    const { error } = await db.from("proposal_votes").insert(
      ROLES.map((r, i) => ({
        proposal_id: proposalId,
        user_id: users[r.key].id,
        vote_type: voteTypes[i],
      }))
    );
    if (error) throw new Error(`proposal_votes insert failed: ${error.message}`);
  }

  // ---- expenses + splits: Settle Up needs a real debtor/creditor pair ------
  // Owner pays 90 split three ways -> owner +60, the other two -30 each, so
  // compute_trip_settlements emits two transfers with names on both sides.
  await db.from("trip_expenses").delete().eq("trip_id", tripId);
  const expenseId = randomUUID();
  {
    const { error } = await db.from("trip_expenses").insert({
      id: expenseId,
      trip_id: tripId,
      amount: 90,
      currency: "EUR",
      category: "food",
      spent_on: today,
      paid_by_user_id: users.owner.id,
      description: "E2E fixture dinner",
    });
    if (error) throw new Error(`expense insert failed: ${error.message}`);
  }
  {
    const { error } = await db.from("trip_expense_splits").insert(
      ROLES.map((r) => ({ expense_id: expenseId, user_id: users[r.key].id, share_amount: 30 }))
    );
    if (error) throw new Error(`expense splits insert failed: ${error.message}`);
  }

  const manifest = {
    createdAt: new Date().toISOString(),
    tripId,
    proposalId,
    activityId: ACTIVITIES[0].id,
    users,
    note: "Throwaway E2E fixtures in PRODUCTION. Remove with --teardown.",
  };
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2), "utf8");

  console.log(`\n  manifest -> ${MANIFEST}`);
  await status();
}

async function status() {
  const db = admin();
  console.log("\n  fixture state:");
  for (const r of ROLES) {
    const u = await findUserByEmail(db, EMAIL_FOR(r.key));
    console.log(`    ${EMAIL_FOR(r.key).padEnd(34)} ${u ? "present" : "absent"}`);
  }
  const { data: trips } = await db
    .from("trips")
    .select("id")
    .eq("title", TRIP_TITLE);
  const tripId = trips?.[0]?.id;
  if (!tripId) {
    console.log("    fixture trip                       absent");
    return;
  }
  const count = async (table: string, col: string, val: string) => {
    const { count: c } = await db
      .from(table)
      .select("id", { head: true, count: "exact" })
      .eq(col, val);
    return c ?? 0;
  };
  console.log(`    fixture trip                       ${tripId}`);
  console.log(`      collaborators   ${await count("trip_collaborators", "trip_id", tripId)}`);
  console.log(`      activity_votes  ${await count("activity_votes", "trip_id", tripId)}`);
  console.log(`      proposals       ${await count("activity_proposals", "trip_id", tripId)}`);
  console.log(`      expenses        ${await count("trip_expenses", "trip_id", tripId)}`);
}

async function teardown() {
  const db = admin();
  const { data: trips } = await db.from("trips").select("id").eq("title", TRIP_TITLE);
  for (const t of trips ?? []) {
    // Explicit child deletes first — not every FK here is ON DELETE CASCADE,
    // and a blocked delete would otherwise look like a silent no-op.
    const { data: props } = await db
      .from("activity_proposals")
      .select("id")
      .eq("trip_id", t.id);
    for (const p of props ?? []) {
      await db.from("proposal_votes").delete().eq("proposal_id", p.id);
    }
    await db.from("activity_proposals").delete().eq("trip_id", t.id);
    await db.from("activity_votes").delete().eq("trip_id", t.id);
    const { data: exps } = await db.from("trip_expenses").select("id").eq("trip_id", t.id);
    for (const e of exps ?? []) {
      await db.from("trip_expense_splits").delete().eq("expense_id", e.id);
    }
    await db.from("trip_expenses").delete().eq("trip_id", t.id);
    await db.from("trip_collaborators").delete().eq("trip_id", t.id);
    const { error } = await db.from("trips").delete().eq("id", t.id);
    console.log(`  trip ${t.id} ${error ? "DELETE FAILED: " + error.message : "deleted"}`);
  }

  for (const r of ROLES) {
    const u = await findUserByEmail(db, EMAIL_FOR(r.key));
    if (!u) {
      console.log(`  ${EMAIL_FOR(r.key)} already absent`);
      continue;
    }
    const { error } = await db.auth.admin.deleteUser(u.id);
    console.log(`  ${EMAIL_FOR(r.key)} ${error ? "DELETE FAILED: " + error.message : "deleted"}`);
  }
  await status();
}

const mode = process.argv.find((a) => /^--(seed|teardown|status)$/.test(a));
if (!mode) {
  console.error("usage: tsx scripts/e2e-fixtures.mts --seed | --status | --teardown");
  process.exit(1);
}
if (mode === "--seed") await seed();
else if (mode === "--status") await status();
else await teardown();
