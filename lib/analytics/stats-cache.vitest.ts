import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Slow aggregate RPCs read small tables that pg_cron refreshes: the wizard's
 * "planned in the last 30 days" figure and the homepage leaderboard hourly,
 * the planner pages' figures and the saved places every six hours.
 * These guards keep each RPC on its cache with a live fallback, the jobs
 * scheduled, the tables closed to clients, and the results what they were.
 */

const ROOT = path.resolve(__dirname, "../..");
const DIR = path.join(ROOT, "supabase", "migrations");
const flat = (s: string) => s.replace(/\s+/g, " ").toLowerCase();
const migrations = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const raw = (f: string) => readFileSync(path.join(DIR, f), "utf8");

/** The latest migration matching `pattern`, whitespace-collapsed and lowercased. */
const latest = (pattern: RegExp) => {
  const file = [...migrations].reverse().find((f) => pattern.test(raw(f)));
  return file ? flat(raw(file)) : "";
};

/** One function's definition, from its CREATE to the end of its body. */
const fn = (sql: string, name: string) => {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  return start < 0 ? "" : sql.slice(start, sql.indexOf("$function$;", start));
};

const baseline = JSON.parse(readFileSync(path.join(ROOT, "supabase", "rls-baseline.json"), "utf8")) as Array<{
  table: string;
  grants: Record<string, string[]>;
  policies: unknown[];
  rls_enabled: boolean;
}>;

function expectClosedToClients(sql: string, table: string) {
  expect(sql).toContain(`alter table public.${table} enable row level security`);
  expect(sql).toContain(`revoke all on public.${table} from public, anon, authenticated`);
  const policy = new RegExp(`create policy[^;]*on public\\.${table}\\b`, "i");
  expect(migrations.filter((f) => policy.test(raw(f)))).toEqual([]);
  const entry = baseline.find((t) => t.table === table);
  expect(entry?.grants).toEqual({});
  expect(entry?.policies).toEqual([]);
  expect(entry?.rls_enabled).toBe(true);
}

describe("wizard planning stats", () => {
  const sql = latest(/create or replace function public\.get_wizard_planning_stats\(/i);
  const rpc = fn(sql, "get_wizard_planning_stats");

  it("the RPC reads the cache, and computes live once the cache is three hours old", () => {
    expect(rpc).toContain("returns integer");
    expect(rpc).toContain("security definer");
    expect(rpc).toContain(
      "from public.wizard_planning_stats_cache s where s.computed_at > now() - interval '3 hours'; if found then return v_planned; end if; return public.compute_wizard_planning_stats();",
    );
  });

  it("stays callable by the service role only", () => {
    expect(sql).not.toMatch(/grant [^;]*on function public\.get_wizard_planning_stats\(/);
    for (const name of ["compute_wizard_planning_stats", "refresh_wizard_planning_stats"]) {
      expect(sql).toContain(`revoke execute on function public.${name}() from public, anon, authenticated`);
    }
  });

  it("an hourly job refreshes the cache", () => {
    expect(sql).toContain(
      "cron.schedule('refresh-wizard-planning-stats', '5 * * * *', 'select public.refresh_wizard_planning_stats()')",
    );
    const refresh = fn(sql, "refresh_wizard_planning_stats");
    expect(refresh).toContain("security definer set search_path to 'public'");
    expect(refresh).toContain("insert into public.wizard_planning_stats_cache");
  });

  it("counts what wizard_step_events_human keeps: change both together", () => {
    const view = latest(/create or replace view public\.wizard_step_events_human/i);
    const start = view.indexOf("create or replace view public.wizard_step_events_human");
    expect(view.slice(start, view.indexOf(";", start))).toBe(
      "create or replace view public.wizard_step_events_human as select w.* from public.wizard_step_events w where not exists ( select 1 from public.page_view_session_labels l where l.session_id = w.session_id and l.day = w.created_at::date and l.is_automation )",
    );
    const compute = fn(sql, "compute_wizard_planning_stats");
    expect(compute).toContain(
      "select distinct session_id, created_at::date as day from public.wizard_step_events where session_id is not null and entered_at > now() - interval '30 days'",
    );
    expect(compute).toContain(
      "where l.session_id = w.session_id and l.day = w.day and l.is_automation and l.day >= (select min(day) from w)",
    );
  });

  it("the cache table is closed to clients and in the RLS baseline", () => {
    expectClosedToClients(sql, "wizard_planning_stats_cache");
  });
});

describe("destination leaderboard", () => {
  const sql = latest(/create or replace function public\.get_destination_leaderboard\(/i);
  const rpc = fn(sql, "get_destination_leaderboard");
  const compute = fn(sql, "compute_destination_leaderboard");

  it("the RPC keeps its signature, reads the cache, and computes live once the cache is three hours old", () => {
    expect(rpc).toContain(
      "get_destination_leaderboard(p_limit integer default 6, p_min_trips integer default 4) returns table(city text, trips_all bigint, trips_30d bigint, top_activities jsonb)",
    );
    expect(rpc).toContain("security definer");
    expect(rpc).toContain("from public.destination_leaderboard_cache c where c.computed_at > now() - interval '3 hours'");
    expect(rpc).toContain("from public.destination_leaderboard_cache c where v_fresh union all");
    expect(rpc).toContain("from public.compute_destination_leaderboard() l where not v_fresh");
  });

  it("holds the privacy thresholds for cached and live rows, whatever the caller passes", () => {
    expect(rpc).toContain(
      "where s.owners >= greatest(coalesce(p_min_trips, 4), 4) order by s.trips_all desc, s.city limit least(greatest(coalesce(p_limit, 6), 1), 50)",
    );
    expect(compute).toContain("having count(distinct owner_key) >= 2");
    expect(compute).toContain("where c.owners >= 4 and exists (select 1 from top_acts ta where ta.city = c.city)");
  });

  it("anon keeps EXECUTE: the homepage calls it with the anon key", () => {
    expect(sql).not.toMatch(/revoke [^;]*on function public\.get_destination_leaderboard\(/);
    for (const name of ["compute_destination_leaderboard", "refresh_destination_leaderboard"]) {
      expect(sql).toContain(`revoke execute on function public.${name}() from public, anon, authenticated`);
    }
  });

  it("an hourly job refreshes the cache, and only the job gets the extra memory", () => {
    expect(sql).toContain(
      "cron.schedule('refresh-destination-leaderboard', '35 * * * *', 'select public.refresh_destination_leaderboard()')",
    );
    const refresh = fn(sql, "refresh_destination_leaderboard");
    expect(refresh).toContain("security definer set search_path to 'public' set work_mem to '64mb'");
    expect(refresh).toContain("delete from public.destination_leaderboard_cache where true;");
    expect(rpc).not.toContain("work_mem");
    expect(compute).not.toContain("work_mem");
  });

  it("the cache table is closed to clients and in the RLS baseline", () => {
    expectClosedToClients(sql, "destination_leaderboard_cache");
  });
});

describe("public stats and saved places", () => {
  const sql = latest(/create or replace function public\.get_public_stats\(/i);

  it("the readers return the cached row and never compute live", () => {
    for (const name of ["get_public_stats", "get_saved_places"]) {
      const rpc = fn(sql, name);
      expect(rpc).toContain("security definer set search_path to 'public'");
      expect(rpc).toContain("from public.public_stats_cache s");
      expect(rpc).not.toContain("compute_");
    }
  });

  it("anon reads the figures; only the service role computes or refreshes them", () => {
    for (const name of ["get_public_stats", "get_saved_places"]) {
      expect(sql).toContain(`grant execute on function public.${name}() to anon, authenticated, service_role`);
    }
    for (const name of ["compute_public_stats", "compute_saved_places", "refresh_public_stats"]) {
      expect(sql).toContain(`revoke execute on function public.${name}() from public, anon, authenticated`);
      expect(sql).not.toMatch(new RegExp(`grant execute on function public\\.${name}\\(\\) to [^;]*anon`));
    }
  });

  it("a place needs three independent trips by three different people", () => {
    const compute = fn(sql, "compute_saved_places");
    expect(compute).toContain("coalesce(t.parent_trip_id, t.id) as lineage");
    expect(compute).toContain("having count(distinct owner) >= 3 and count(distinct lineage) >= 3");
    expect(compute).toContain("and not coalesce(t.is_hidden, false)");
  });

  it("planning sessions leave out automation and probes", () => {
    const compute = fn(sql, "compute_public_stats");
    expect(compute).toContain("and w.session_id not like 'e2eprobe%'");
    expect(compute).toContain("where l.session_id = w.session_id and l.is_automation");
  });

  it("a job refreshes the cache every six hours, with the extra memory", () => {
    expect(sql).toContain("cron.schedule('refresh-public-stats', '15 */6 * * *', 'select public.refresh_public_stats()')");
    expect(fn(sql, "refresh_public_stats")).toContain("security definer set search_path to 'public' set work_mem to '64mb'");
  });

  it("the cache table is closed to clients and in the RLS baseline", () => {
    expectClosedToClients(sql, "public_stats_cache");
  });
});
