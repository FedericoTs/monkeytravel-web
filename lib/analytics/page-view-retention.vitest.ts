import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

/**
 * Raw page views are kept 180 days for people and 14 days for everything the
 * human view leaves out. The nightly purge's idea of "not human" must stay the
 * complement of page_views_human: if the view changes, change the purge too.
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

  it("keeps human page views 180 days and the rest 14", () => {
    expect(purge).toContain("created_at < now() - interval '180 days'");
    expect(purge).toContain("p.created_at < now() - interval '14 days'");
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
