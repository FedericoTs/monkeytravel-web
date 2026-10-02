import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * A referral code is readable only by its owner. Every lookup of someone
 * else's code (the join page, click tracking, the referee's completion) runs
 * on the server with the service role. These guards fail if one of them goes
 * back to a client that RLS limits to the caller's own code, or if the table
 * opens up to other readers again.
 */

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8").replace(/\r/g, "");

const ADMIN_LOOKUP = /createAdminClient\(\)\s*\.from\("referral_codes"\)/g;

describe("referral codes are looked up on the server", () => {
  it("the join page reads the code with the service role, for the metadata and the page", () => {
    const page = read("app/[locale]/(app)/join/[code]/page.tsx");
    expect(page.match(ADMIN_LOOKUP)).toHaveLength(2);
    expect(page).not.toMatch(/supabase\s*\.from\("referral_codes"\)/);
  });

  it("click tracking reads the code with the service role", () => {
    expect(read("app/api/referral/click/route.ts").match(ADMIN_LOOKUP)).toHaveLength(1);
  });

  it("completion reads the referrer's code with the service role", () => {
    const src = read("lib/referral/completion.ts");
    expect(src).toMatch(/await adminDb\s*\.from\("referral_codes"\)/);
    expect(src).not.toMatch(/supabase\s*\.from\("referral_codes"\)/);
  });

  it("the committed RLS baseline lets only a code's owner read it", () => {
    const baseline = JSON.parse(read("supabase/rls-baseline.json")) as Array<{
      table: string;
      grants: Record<string, string[]>;
      policies: Array<{ cmd: string; roles: string[]; using: string | null }>;
    }>;
    const entry = baseline.find((t) => t.table === "referral_codes")!;
    expect(entry.grants.anon ?? []).not.toContain("SELECT");
    const reads = entry.policies.filter((p) => p.cmd === "SELECT" || p.cmd === "ALL");
    expect(reads).toEqual([
      expect.objectContaining({ roles: ["authenticated"], using: "(user_id = ( SELECT auth.uid() AS uid))" }),
    ]);
  });
});
