import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

/**
 * page_views stores each user-agent string once, in user_agents, and new rows
 * keep only its id: their user_agent column is empty. Anything that reads the
 * user agent must go through page_views_with_ua, or it silently sees nothing
 * for every row written since.
 */

const DIR = join(process.cwd(), "supabase", "migrations");
const latestRaw = (pattern: RegExp) => {
  const file = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort().reverse()
    .find((f) => pattern.test(readFileSync(join(DIR, f), "utf8")));
  return file ? readFileSync(join(DIR, file), "utf8").replace(/\r\n/g, "\n") : "";
};
const flat = (sql: string) => sql.replace(/\s+/g, " ").toLowerCase();

describe("page_views user agents", () => {
  const store = flat(latestRaw(/create or replace function public\.page_views_store_user_agent/i));

  it("moves the string to user_agents on insert and owns user_agent_id", () => {
    expect(store).toContain("before insert on public.page_views");
    expect(store).toContain("new.user_agent_id := null;");
    expect(store).toContain("new.user_agent_id := v_id; new.user_agent := null;");
  });

  it("keeps user_agents and the trigger function away from anon and signed-in users", () => {
    expect(store).toContain("revoke all on table public.user_agents from public, anon, authenticated;");
    expect(store).toContain("revoke execute on function public.page_views_store_user_agent() from public, anon, authenticated;");
    expect(store).toContain("revoke all on public.page_views_with_ua from public, anon, authenticated;");
  });

  it("resolves the user agent for old rows and new", () => {
    const view = flat(latestRaw(/create or replace view public\.page_views_with_ua/i));
    expect(view).toContain("coalesce(p.user_agent, u.ua) as user_agent");
    expect(view).toContain("left join public.user_agents u on u.id = p.user_agent_id");
  });

  it("keeps page_views_human on the resolved rows, security invoker", () => {
    const view = flat(latestRaw(/create or replace view public\.page_views_human/i));
    expect(view).toContain("create or replace view public.page_views_human with (security_invoker = true) as");
    expect(view).toContain("from public.page_views_with_ua p");
  });

  it("reads the user agent through page_views_with_ua in every labelling rule", () => {
    const sql = latestRaw(/create or replace function public\.label_automation_sessions/i);
    const fn = sql.slice(sql.search(/create or replace function public\.label_automation_sessions/i));
    const blocks = fn.split(/\n {2}(?:with )?(?=\w+ as \(\n)/);
    const readers = blocks.filter((b) => /user_agent/.test(b));
    expect(readers.length).toBeGreaterThan(0);
    for (const block of readers) {
      expect(block, block.slice(0, 40)).toContain("from public.page_views_with_ua");
      expect(block, block.slice(0, 40)).not.toMatch(/from public\.page_views\b(?!_)/);
    }
  });
});
