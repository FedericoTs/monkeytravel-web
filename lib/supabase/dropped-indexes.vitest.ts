import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Indexes dropped because no query could use them. A later migration must not
 * create one again by accident: the last migration that names each one drops it.
 */

const DROPPED = ["idx_api_logs_cache_hit", "geo_cities_pop_idx", "idx_trips_is_archived"];

const DIR = path.resolve(__dirname, "../../supabase/migrations");
const statements = readdirSync(DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .flatMap((f) => readFileSync(path.join(DIR, f), "utf8").replace(/--[^\n]*/g, "").toLowerCase().split(";"));

describe("dropped indexes stay dropped", () => {
  for (const name of DROPPED) {
    it(name, () => {
      const named = new RegExp(`\\b${name}\\b`);
      const ddl = statements.filter((s) => named.test(s) && /\b(create|drop)\s+(unique\s+)?index\b/.test(s));
      expect(ddl.at(-1), `the last migration naming ${name} must drop it`).toMatch(/\bdrop\s+index\b/);
    });
  }
});
