import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * The counter functions are service-role only (migration 20260924100000).
 * These tests pin the two halves of that: the helper runs them on the
 * service-role client and never throws, and nothing else in the app calls
 * them — a call on a signed-in user's client would fail with permission
 * denied, and the like/save/fork would succeed while the counter silently
 * stopped moving.
 */

const rpc = vi.fn();
const createAdminClient = vi.fn(() => ({ rpc }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => createAdminClient(),
}));

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  rpc.mockReset();
  createAdminClient.mockClear();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
});

describe("runTripCounter", () => {
  it("runs the function on the service-role client with the trip id", async () => {
    rpc.mockResolvedValue({ data: 4, error: null });
    const { runTripCounter } = await import("./counters");

    await expect(runTripCounter("increment_trip_like_count", "trip-1", "t")).resolves.toBe(4);
    expect(createAdminClient).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("increment_trip_like_count", { p_trip_id: "trip-1" });
  });

  it("returns null and logs drift when the function errors", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "permission denied" } });
    const { runTripCounter } = await import("./counters");

    await expect(runTripCounter("increment_trip_fork_count", "trip-1", "trip-fork")).resolves.toBeNull();
    expect(consoleError).toHaveBeenCalled();
    expect(String(consoleError.mock.calls[0][0])).toContain("trip-fork");
  });

  it("returns null rather than throwing when the service key is missing", async () => {
    createAdminClient.mockImplementationOnce(() => {
      throw new Error("Missing Supabase admin credentials");
    });
    const { runTripCounter } = await import("./counters");

    await expect(runTripCounter("update_trip_trending_score", "trip-1", "t")).resolves.toBeNull();
  });

  it("returns null when the function returns something that is not a number", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const { runTripCounter } = await import("./counters");

    await expect(runTripCounter("decrement_trip_save_count", "trip-1", "t")).resolves.toBeNull();
  });
});

describe("incrementTemplateCopyCount", () => {
  it("passes the template id under the function's own argument name", async () => {
    rpc.mockResolvedValue({ data: 7, error: null });
    const { incrementTemplateCopyCount } = await import("./counters");

    await expect(incrementTemplateCopyCount("tpl-1", "t")).resolves.toBe(7);
    expect(rpc).toHaveBeenCalledWith("increment_template_copy_count", { template_id: "tpl-1" });
  });

  it("never throws", async () => {
    rpc.mockRejectedValue(new Error("network"));
    const { incrementTemplateCopyCount } = await import("./counters");

    await expect(incrementTemplateCopyCount("tpl-1", "t")).resolves.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Source guards
// ---------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, "../..");
const COUNTER_FUNCTIONS = [
  "increment_trip_like_count",
  "decrement_trip_like_count",
  "increment_trip_save_count",
  "decrement_trip_save_count",
  "increment_trip_fork_count",
  "increment_template_copy_count",
  "update_trip_trending_score",
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx|mts|js|mjs)$/.test(name) && !/\.vitest\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

/** Matches `x.rpc("fn"` / `x.rpc(\n  'fn'` — a direct call, on whichever client. */
function callsDirectly(src: string, fn: string): boolean {
  return new RegExp(`\\.rpc\\(\\s*["'\`]${fn}["'\`]`).test(src);
}

describe("counter functions are only called through lib/explore/counters.ts", () => {
  it("the guard recognises the call shapes the routes used before", () => {
    expect(callsDirectly(`await supabase.rpc("update_trip_trending_score", { p_trip_id: id });`, "update_trip_trending_score")).toBe(true);
    expect(callsDirectly(`supabase.rpc(\n    "increment_trip_like_count",\n    { p_trip_id: tripId }`, "increment_trip_like_count")).toBe(true);
    expect(callsDirectly(`runTripCounter("increment_trip_like_count", tripId, "t")`, "increment_trip_like_count")).toBe(false);
  });

  it("no other file calls a counter function directly", () => {
    const helper = path.join(ROOT, "lib", "explore", "counters.ts");
    const offenders: string[] = [];
    for (const dir of ["app", "lib", "components", "hooks", "scripts", "supabase/functions"]) {
      let files: string[] = [];
      try {
        files = sourceFiles(path.join(ROOT, dir));
      } catch {
        continue; // directory absent in this checkout
      }
      for (const file of files) {
        if (file === helper) continue;
        const src = readFileSync(file, "utf8");
        for (const fn of COUNTER_FUNCTIONS) {
          if (callsDirectly(src, fn)) {
            offenders.push(`${path.relative(ROOT, file)}: ${fn}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the migration closes every one of them to everyone but the service role", () => {
    const sql = readFileSync(
      path.join(ROOT, "supabase", "migrations", "20260924100000_counter_rpcs_service_role.sql"),
      "utf8"
    );
    for (const fn of COUNTER_FUNCTIONS) {
      expect(sql).toContain(
        `revoke execute on function public.${fn}(uuid) from public, anon, authenticated;`
      );
      expect(sql).toContain(`grant execute on function public.${fn}(uuid) to service_role;`);
    }
  });
});
