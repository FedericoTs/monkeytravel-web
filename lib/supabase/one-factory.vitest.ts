// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import { describe, expect, it, vi } from "vitest";

/**
 * Every server-side Supabase client comes from one place, so each gets the time
 * limit in timeout-fetch.ts, and whatever is added to the clients later. A route that
 * builds its own hangs with the database, and nothing would say so.
 */

const ROOT = process.cwd();

/** The factories, and the module-level client that has to survive a build with no env. */
const MAY_BUILD_A_CLIENT = ["lib/supabase/admin.ts", "lib/supabase/anon.ts", "lib/supabase.ts"];

function sources(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(join(ROOT, path)).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.(vitest|spec|test)\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("who builds a Supabase client", () => {
  it("is only the factories", () => {
    const builders = ["app", "lib", "components"]
      .flatMap(sources)
      .filter((file) => /import\s*\{[^}]*\bcreateClient\b[^}]*\}\s*from\s*["']@supabase\/supabase-js["']/.test(readFileSync(join(ROOT, file), "utf8")))
      .map((file) => relative(ROOT, join(ROOT, file)).replace(/\\/g, "/"))
      .sort();
    expect(builders).toEqual([...MAY_BUILD_A_CLIENT].sort());
  });
});

describe("createAnonClient", () => {
  it("uses the public key with no session, and the time limit", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://db.example.com");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-key");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
    const seen: Array<{ url: string; key: string | null }> = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ url: String(input), key: new Headers(init?.headers).get("apikey") });
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return new Response("[]", { headers: { "content-type": "application/json" } });
    });
    const { createAnonClient } = await import("./anon");
    await createAnonClient().from("destinations").select("id");
    expect(seen).toEqual([{ url: expect.stringContaining("https://db.example.com/rest/v1/destinations"), key: "public-key" }]);
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("says so when the public credentials are missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    const { createAnonClient } = await import("./anon");
    expect(() => createAnonClient()).toThrow("Missing Supabase public credentials");
    vi.unstubAllEnvs();
  });
});
