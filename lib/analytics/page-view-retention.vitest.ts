import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

/**
 * Raw page views are kept 120 days for people and 7 days for everything the
 * human view leaves out; wizard step events are kept 180 days, their step-1
 * heartbeats 14, and the purged tables are vacuumed right after the purge. The
 * nightly purge's idea of "not human" must stay the complement of
 * page_views_human: if the view changes, change the purge too.
 */

const DIR = join(process.cwd(), "supabase", "migrations");
const latest = (pattern: RegExp) => {
  const file = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort().reverse()
    .find((f) => pattern.test(readFileSync(join(DIR, f), "utf8")));
  return file ? readFileSync(join(DIR, file), "utf8").replace(/\s+/g, " ").toLowerCase() : "";
};

describe("page view retention", () => {
  const purge = latest(/create or replace function public\.purge_old_analytics_rows/i);
  const view = latest(/create or replace view public\.page_views_human/i);

  it("keeps human page views 120 days and the rest 7", () => {
    expect(purge).toContain("select id from public.page_views where created_at < now() - interval '120 days'");
    expect(purge).toContain("p.created_at < now() - interval '7 days'");
    expect(purge).not.toContain("p.created_at < now() - interval '14 days'");
  });

  it("drops exactly what the human view leaves out", () => {
    expect(view).toContain("is_bot = false");
    expect(view).toContain("is_prefetch = false");
    expect(view).toContain("l.session_id = p.session_id and l.day = p.created_at::date and l.is_automation");
    expect(purge).toContain(
      "p.is_bot or p.is_prefetch or exists ( select 1 from public.page_view_session_labels l where l.session_id = p.session_id and l.day = p.created_at::date and l.is_automation)",
    );
  });

  it("stays callable by the service role only", () => {
    expect(purge).toContain("revoke execute on function public.purge_old_analytics_rows() from public, anon, authenticated");
  });
});

describe("wizard step event retention", () => {
  const purge = latest(/create or replace function public\.purge_old_analytics_rows/i);

  it("deletes rows older than 180 days in batches and reports the count", () => {
    expect(purge).toContain(
      "delete from public.wizard_step_events where id in ( select id from public.wizard_step_events where created_at < now() - interval '180 days' order by created_at limit 20000 );",
    );
    expect(purge).toContain("wizard_events_deleted bigint");
    expect(purge).toContain("wizard_events_deleted := v_wiz + v_hb;");
  });

  it("keeps step-1 heartbeats 14 days", () => {
    expect(purge).toContain(
      "select id from public.wizard_step_events where step = 'step1_heartbeat' and created_at < now() - interval '14 days' order by created_at limit 20000",
    );
  });

  it("vacuums the purged tables soon after the nightly deletes", () => {
    const tuning = latest(/autovacuum_vacuum_scale_factor/i);
    for (const table of ["page_views", "wizard_step_events"]) {
      expect(tuning).toContain(
        `alter table public.${table} set (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_threshold = 2000);`,
      );
    }
  });
});

describe("API call retention", () => {
  const purge = latest(/create or replace function public\.purge_old_analytics_rows/i);
  const rollup = latest(/create or replace function public\.refresh_api_cost_daily/i);

  it("keeps raw calls 90 days", () => {
    expect(purge).toContain("select id from public.api_request_logs where timestamp < now() - interval '90 days'");
  });

  it("sums every day into api_cost_daily before the purge runs", () => {
    expect(rollup).toContain("insert into public.api_cost_daily");
    expect(rollup).toContain("select public.refresh_api_cost_daily(400);");
    expect(rollup).toContain("cron.schedule('refresh-api-cost-daily', '50 2 * * *'");
    expect(rollup).toContain("revoke execute on function public.refresh_api_cost_daily(integer) from public, anon, authenticated");
    expect(rollup).toContain("revoke all on table public.api_cost_daily from anon, authenticated");
  });
});

describe("database headroom", () => {
  const headroom = latest(/cron\.schedule\(\s*'vacuum-after-purge'/i);

  it("vacuums every purged table, and trips, right after the 03:10 purge", () => {
    expect(headroom).toContain("'vacuum-after-purge', '25 3 * * *'");
    expect(headroom).toContain(
      "'vacuum (analyze) public.page_views, public.api_request_logs, public.page_view_session_labels, public.consent_events, public.wizard_step_events, public.trips'",
    );
  });

  it("drops the two indexes no query uses", () => {
    expect(headroom).toContain("drop index if exists public.idx_api_logs_api_name;");
    expect(headroom).toContain("drop index if exists public.idx_page_views_country_code;");
  });
});

describe("label and consent retention", () => {
  const purge = latest(/create or replace function public\.purge_old_analytics_rows/i);

  it("drops a session label once nothing it hides can still be read", () => {
    expect(purge).toContain("where x.day < current_date - 14 and (x.day < current_date - 180 or (not exists");
    expect(purge).toContain("select 1 from public.wizard_step_events w where w.session_id = x.session_id");
    expect(purge).toContain("select 1 from public.trip_views v where v.session_id = x.session_id and v.viewed_on = x.day");
  });

  it("keeps consent decisions 13 months and banner impressions 90 days", () => {
    expect(purge).toContain(
      "where (event in ('shown', 'minimized') and created_at < now() - interval '90 days') or created_at < now() - interval '395 days'",
    );
  });
});
