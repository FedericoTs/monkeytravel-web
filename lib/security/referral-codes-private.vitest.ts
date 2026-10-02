import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * A referral code is readable only by its owner. Every lookup of someone
 * else's code (the join page, click tracking, the referee's completion) runs
 * on the server with the service role. These guards fail if one of them goes
 * back to a client that RLS limits to the caller's own code.
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
});
