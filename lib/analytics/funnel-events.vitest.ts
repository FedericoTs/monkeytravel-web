/** @vitest-environment node */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FUNNEL_EVENT_TYPES } from "./funnel-events";

describe("the funnel event vocabulary", () => {
  // The server writer swallows every error, so a type the CHECK does not list
  // would be dropped without a trace.
  it("matches the CHECK constraint in the newest migration that defines it", () => {
    const dir = join(process.cwd(), "supabase", "migrations");
    const marker = "ADD CONSTRAINT funnel_events_event_type_check";
    const newest = readdirSync(dir)
      .filter((name) => name.endsWith(".sql"))
      .sort()
      .reverse()
      .map((name) => readFileSync(join(dir, name), "utf8"))
      .find((sql) => sql.includes(marker));
    expect(newest).toBeDefined();
    const check = (newest as string).slice((newest as string).indexOf(marker));
    const inDatabase = [...check.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
    expect(new Set(inDatabase)).toEqual(new Set(FUNNEL_EVENT_TYPES));
  });
});
