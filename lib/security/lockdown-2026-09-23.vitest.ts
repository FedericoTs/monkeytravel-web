import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Source guards for the 2026-09-23 lockdown. Each database change closes a
 * table or function to the signed-in user's own client; each code change
 * below moves the one legitimate writer to the service role first. If a
 * writer drifts back to the user's client, the write fails with 42501 and
 * most of these routes swallow it — views stop being recorded, AI usage
 * stops being counted (quotas stop holding), bananas stop moving — with no
 * error anyone sees. These tests are that error.
 */

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8").replace(/\r/g, "");
const migration = (name: string) => read(path.join("supabase", "migrations", name));

describe("writers moved to the service role", () => {
  it("the trip view route inserts through the service role and checks the trip", () => {
    const src = read("app/api/trips/[id]/view/route.ts");
    expect(src).toMatch(/admin\.from\("trip_views"\)\.insert\(/);
    expect(src).not.toMatch(/supabase\.from\("trip_views"\)/);
    expect(src).toContain("verifiedSource(source, trip, isOwner, isCollaborator)");
    expect(src).toMatch(/if \(!trip \|\| trip\.deleted_at\)/);
  });

  it("submit-trending writes trending_approved / trending_score through the service role", () => {
    const src = read("app/api/trips/[id]/submit-trending/route.ts");
    const updates = src.match(/await (\w+(?:\(\))?)\s*\.from\("trips"\)\s*\.update\(/g) ?? [];
    expect(updates.length).toBe(2);
    for (const u of updates) expect(u).toContain("createAdminClient()");
  });

  it("incrementUsage calls increment_usage on the service role", () => {
    const src = read("lib/usage-limits/check.ts");
    const body = src.slice(src.indexOf("export async function incrementUsage"));
    const fn = body.slice(0, body.indexOf("\n}\n"));
    expect(fn).toContain("const supabase = createAdminClient();");
    expect(fn).toContain('supabase.rpc("increment_usage"');
    expect(fn).not.toContain("await createClient()");
  });

  it("the banana award route validates the reference and credits on the service role", () => {
    const src = read("app/api/bananas/award/route.ts");
    expect(src).toContain("isValidAwardReference(type as AwardType, tripId, referenceId, trip.itinerary)");
    expect(src).toMatch(/addBananas\(\s*createAdminClient\(\),/);
  });

  it("the banana spend route runs the balance and spend functions on the service role", () => {
    const src = read("app/api/bananas/spend/route.ts");
    expect(src).not.toMatch(/getAvailableBalance\(supabase,/);
    expect(src).toMatch(/spendBananas\(\s*admin,/);
  });

  it("the referral click counter runs on the service role", () => {
    expect(read("app/api/referral/click/route.ts")).toMatch(/createAdminClient\(\)\.rpc\(\s*"increment_referral_clicks"/);
  });

  it("tester-code redemption inserts access through the service role", () => {
    const src = read("lib/early-access/index.ts");
    expect(src).toMatch(/admin\.from\("user_tester_access"\)\.insert\(/);
    expect(src).not.toMatch(/supabase\.from\("user_tester_access"\)\.insert\(/);
  });

  it("the unused collaborator POST is retired", () => {
    const src = read("app/api/trips/[id]/collaborators/route.ts");
    expect(src).toMatch(/export async function POST\(\) \{\s*return errors\.gone\(/);
    expect(src).not.toMatch(/from\("trip_collaborators"\)\s*\.insert\(/);
  });

  it("invite creation bounds maxUses and expiresInDays like the insert policy", () => {
    const src = read("app/api/trips/[id]/invites/route.ts");
    expect(src).toContain("maxUses < 1 || maxUses > 100");
    expect(src).toContain("expiresInDays < 1 || expiresInDays > 3650");
  });
});

describe("the guards are shaped so they actually run", () => {
  // A SECURITY DEFINER guard sees current_user = postgres for every caller
  // and lets everything through. Both guards must be invoker.
  for (const [file, fn] of [
    ["20260924120000_trips_protected_columns.sql", "trips_guard_protected_columns"],
    ["20260924116000_users_protected_columns.sql", "users_guard_protected_columns"],
  ] as const) {
    it(`${fn} is SECURITY INVOKER and trusts only the service and owner roles`, () => {
      const sql = migration(file);
      const body = sql.slice(sql.indexOf(`create or replace function public.${fn}()`));
      const head = body.slice(0, body.indexOf("as $function$"));
      expect(head).toContain("security invoker");
      expect(head).not.toContain("security definer");
      expect(body).toContain("current_user in ('postgres', 'service_role', 'supabase_admin')");
      expect(sql).toMatch(new RegExp(`create trigger ${fn}\\s+before insert or update on public\\.`));
    });
  }

  it("the trips guard refuses a new owner or parent and restores every counter and flag", () => {
    const sql = migration("20260924120000_trips_protected_columns.sql");
    expect(sql).toContain("if new.user_id is distinct from old.user_id then");
    expect(sql).toContain("if new.parent_trip_id is distinct from old.parent_trip_id then");
    for (const col of [
      "like_count", "save_count", "fork_count", "template_copy_count", "view_count",
      "trending_score", "trending_approved", "is_editors_pick", "is_hidden",
      "reported_count", "is_template",
    ]) {
      expect(sql).toContain(`new.${col} := old.${col};`);
    }
  });

  it("the users guard keeps every plan, billing and referral column", () => {
    const sql = migration("20260924116000_users_protected_columns.sql");
    for (const col of [
      "subscription_tier", "subscription_expires_at", "stripe_customer_id",
      "stripe_subscription_id", "is_pro", "banana_balance", "referral_tier",
      "lifetime_referral_conversions", "referred_by_code", "referral_completed_at",
      "signed_up_via_trip_invite",
    ]) {
      expect(sql).toContain(`new.${col} := old.${col};`);
    }
    expect(sql).toMatch(/lower\(new\.email\) is distinct from lower\(v_jwt_email\)/);
  });

  it("the view-count trigger goes before the service-role view route is live", () => {
    const sql = migration("20260924113000_drop_trip_view_count_trigger.sql");
    expect(sql).toContain("drop trigger if exists trigger_update_trip_view_count on public.trip_views;");
    const scoring = migration("20260924120000_trips_protected_columns.sql");
    expect(scoring).toMatch(/from public\.trip_views\s+where trip_id = p_trip_id and not is_bot;/);
  });
});

describe("the closed functions and tables", () => {
  it("every usage, banana, referral and tester function is service-role only", () => {
    const sql = migration("20260924122000_usage_bananas_service_role.sql");
    for (const fn of [
      "increment_usage(uuid, text, text, text, integer)",
      "add_bananas(uuid, integer, text, text, text)",
      "spend_bananas(uuid, integer, text, text, text)",
      "check_and_unlock_tier(uuid)",
      "get_available_banana_balance(uuid)",
      "get_user_usage(uuid, text, text)",
      "expire_old_bananas()",
      "increment_referral_clicks(uuid)",
      "increment_referral_conversions(uuid)",
      "increment_tester_code_usage()",
      "consume_tester_code(uuid)",
    ]) {
      expect(sql).toContain(`revoke execute on function public.${fn} from public, anon, authenticated;`);
      expect(sql).toContain(`grant execute on function public.${fn} to service_role;`);
    }
    expect(sql).toContain("if p_amount is null or p_amount < 1 then");
  });

  it("invite accept and anonymous-trip claim are service-role only", () => {
    const sql = migration("20260924114000_collaborators_invites_claim.sql");
    expect(sql).toContain("revoke execute on function public.accept_trip_invite(text, uuid) from public, anon, authenticated;");
    expect(sql).toContain("revoke execute on function public.claim_anonymous_trip(text, uuid) from public, anon, authenticated;");
    expect(sql).toContain('drop policy if exists "Trip owners can insert collaborators" on public.trip_collaborators;');
    expect(sql).toContain("grant update (role) on public.trip_collaborators to authenticated;");
    expect(sql).toContain("grant update (is_active) on public.trip_invites to authenticated;");
  });

  it("trip_views loses its anon/authenticated grants and insert policy", () => {
    const sql = migration("20260924121000_trip_views_service_role_only.sql");
    expect(sql).toContain("drop policy if exists trip_views_anon_insert on public.trip_views;");
    expect(sql).toContain("revoke all on public.trip_views from public, anon, authenticated;");
  });

  it("activity_index only indexes published trips", () => {
    const sql = migration("20260924115000_activity_index_public_only.sql");
    expect(sql).toContain("and t.visibility = 'public'");
    expect(sql).toContain("and t.deleted_at is null");
    expect(sql).not.toMatch(/'shared'::text\]|in \('public', 'shared'\)\s*$/m);
    expect(sql).toContain("create unique index activity_index_row_key_uq");
  });
});
