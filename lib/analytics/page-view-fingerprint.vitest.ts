import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

/**
 * page_view_fingerprint keeps each visitor fingerprint as the md5 of the
 * string it used to store. The nightly rollup must hash exactly that string
 * (user agent, country and city run together, nothing between them), or every
 * visitor counted before would be counted again.
 */

const DIR = join(process.cwd(), "supabase", "migrations");
const latest = (pattern: RegExp) => {
  const file = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort().reverse()
    .find((f) => pattern.test(readFileSync(join(DIR, f), "utf8")));
  return file ? readFileSync(join(DIR, file), "utf8").replace(/\s+/g, " ").toLowerCase() : "";
};

describe("page view fingerprints", () => {
  const conversion = latest(/alter column fp type uuid/i);
  const rollup = latest(/create or replace function public\.refresh_page_view_rollup/i);

  it("converts the stored strings to their md5", () => {
    expect(conversion).toContain("alter table public.page_view_fingerprint alter column fp type uuid using md5(fp)::uuid;");
  });

  it("hashes the same string in the nightly rollup", () => {
    expect(rollup).toContain(
      "insert into public.page_view_fingerprint (fp, first_seen) select md5(concat(coalesce(user_agent,''), coalesce(country_code,''), coalesce(city,'')))::uuid,",
    );
    expect(rollup).toContain("on conflict (fp) do nothing;");
  });
});
