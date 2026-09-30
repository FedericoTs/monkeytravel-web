// @vitest-environment jsdom
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WIZARD_EVENT_STEPS, landingAttribution } from "./wizardEvents";

function setReferrer(value: string) {
  Object.defineProperty(document, "referrer", { value, configurable: true });
}

describe("landingAttribution", () => {
  afterEach(() => {
    setReferrer("");
    window.history.replaceState(null, "", "/trips/new");
  });

  it("keeps the referrer's host and path but never its query, and reads utm_source from the URL", () => {
    setReferrer("https://www.google.com/search?q=ai+trip+planner&token=secret");
    window.history.replaceState(null, "", "/it/trips/new?utm_source=newsletter&destination=Roma");
    expect(landingAttribution()).toEqual({ referrer: "www.google.com/search", utm_source: "newsletter" });
  });

  it("sends nothing when there is no referrer and no utm_source", () => {
    setReferrer("");
    expect(landingAttribution()).toEqual({});
  });

  it("drops a referrer it cannot parse and caps the lengths", () => {
    setReferrer("not a url");
    window.history.replaceState(null, "", `/trips/new?utm_source=${"x".repeat(100)}`);
    const out = landingAttribution();
    expect(out.referrer).toBeUndefined();
    expect(out.utm_source).toHaveLength(64);
  });
});

describe("the step vocabulary", () => {
  it("matches the CHECK constraint in the newest migration that defines it", () => {
    const dir = join(process.cwd(), "supabase", "migrations");
    const marker = "ADD CONSTRAINT wizard_step_events_step_check";
    const newest = readdirSync(dir)
      .filter((name) => name.endsWith(".sql"))
      .sort()
      .reverse()
      .map((name) => readFileSync(join(dir, name), "utf8"))
      .find((sql) => sql.includes(marker));
    expect(newest).toBeDefined();
    const check = (newest as string).slice((newest as string).indexOf(marker));
    const inDatabase = [...check.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
    expect(new Set(inDatabase)).toEqual(new Set(WIZARD_EVENT_STEPS));
  });
});

describe("wizard_step_events_human", () => {
  // The view freezes its columns when created, so a column added to the table
  // stays invisible to funnel reads until a later migration recreates it.
  it("is recreated in or after the newest migration that adds a table column", () => {
    const dir = join(process.cwd(), "supabase", "migrations");
    const files = readdirSync(dir).filter((name) => name.endsWith(".sql")).sort();
    const sql = (name: string) => readFileSync(join(dir, name), "utf8");
    const addsColumn = /alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?wizard_step_events\b[^;]*\badd\s+column/i;
    const recreatesView = /create\s+or\s+replace\s+view\s+(?:public\.)?wizard_step_events_human\b/i;
    const lastColumn = files.filter((name) => addsColumn.test(sql(name))).pop();
    const lastView = files.filter((name) => recreatesView.test(sql(name))).pop();
    expect(lastColumn).toBeDefined();
    expect(lastView).toBeDefined();
    expect((lastView as string) >= (lastColumn as string)).toBe(true);
  });
});
