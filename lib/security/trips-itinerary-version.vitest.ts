import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The shape of the itinerary_version trigger (20260924125000). Each of these
 * is a way it silently stops working or starts refusing every editor save.
 */

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8").replace(/\r/g, "");
const sql = read("supabase/migrations/20260924125000_trips_itinerary_version.sql");

describe("trips_itinerary_version", () => {
  it("fires after the editor guard and before updated_at (name order)", () => {
    // BEFORE row triggers fire in name order. Before the guard, the guard
    // would see the bumped version as an editor change and refuse every save.
    const name = sql.match(/create trigger (\w+)/)?.[1] ?? "";
    expect(name).toBe("trips_itinerary_version");
    const order = ["trips_guard_protected_columns", name, "update_trips_updated_at"];
    expect([...order].sort()).toEqual(order);
    expect(sql).toMatch(/before insert or update on public\.trips/);
  });

  it("ignores whatever the writer sends: starts from OLD, then bumps", () => {
    const reset = sql.indexOf("new.itinerary_version := old.itinerary_version;");
    const bump = sql.indexOf("new.itinerary_version := old.itinerary_version + 1;");
    expect(reset).toBeGreaterThan(-1);
    expect(bump).toBeGreaterThan(reset);
    expect(sql).toMatch(/if tg_op = 'INSERT' then\s+new\.itinerary_version := 0;/);
  });

  it("does not count photo-only changes", () => {
    expect(sql).toContain("a.act - 'image_url'");
  });

  it("is not in the editor allowlist (an editor sending a version must be refused)", () => {
    const guard = read("supabase/migrations/20260924124000_trips_editor_columns.sql");
    const list = guard.match(/c_editor_columns constant text\[\] := array\[([^\]]*)\]/)?.[1] ?? "";
    expect(list).not.toContain("itinerary_version");
  });
});

describe("the save paths use it", () => {
  it("PATCH filters on the base version and answers a stale save with 409", () => {
    const route = read("app/api/trips/[id]/route.ts");
    expect(route).toContain('write = write.eq("itinerary_version", baseItineraryVersion)');
    expect(route).toContain('code: "ITINERARY_CONFLICT"');
  });

  it("regenerate-day and enrichment write compare-and-set", () => {
    expect(read("app/api/ai/regenerate-day/route.ts")).toContain("casUpdateItinerary(supabase");
    expect(read("lib/images/enrichTrip.ts")).toContain("casUpdateItinerary(db");
  });

  it("the trip page never aborts a save and reads the version from props only once", () => {
    const page = read("app/[locale]/trips/[id]/TripDetailClient.tsx");
    expect(page).not.toMatch(/saveAbortRef|new AbortController\(\)/);
    expect(page.match(/trip\.itineraryVersion/g)?.length).toBe(1);
  });

  it("every save sends a base that belongs to its content", () => {
    const page = read("app/[locale]/trips/[id]/TripDetailClient.tsx");
    for (const call of page.match(/sync\.send\([^)]*\)/g) ?? []) expect(call).toMatch(/sync\.send\(payload, base\)/);
    // Explicit Save: the base is taken together with the content.
    expect(page).toContain("saveExplicit(JSON.stringify(editedItinerary), editedItinerary, sync.baseVersion())");
    // Autosave: an edit built before a regeneration/reload is not sent on the new base.
    expect(page).toContain("pendingEpochRef.current = sync.epoch();");
    expect(page).toContain("if (pendingEpochRef.current !== sync.epoch()) return;");
    // A day regeneration this tab started moves the epoch; its own saves do not.
    expect(page).toContain("sync.adoptWrite(to);");
    expect(page).not.toMatch(/sync\.adopt\(to\)/);
  });

  it("no server write runs over edits held by a conflict, and adopting a server copy drops undo history", () => {
    const page = read("app/[locale]/trips/[id]/TripDetailClient.tsx");
    expect(page).toContain('if (conflictRef.current) throw new ItineraryWriteBlockedError(t("detail.writeBlockedConflict"));');
    // ...nor over edits still unsaved, unless the write keeps them (a regenerated day is spliced in).
    expect(page).toContain('throw new ItineraryWriteBlockedError(t("detail.writeBlockedUnsaved"));');
    expect(page).toContain("}, { keepsLocalEdits: true });");
    // Every adoption of content read from the server clears undo history
    // (Keep mine is exempt: the content it keeps, and its history, are the user's).
    const from = (marker: string, length: number) => {
      const at = page.indexOf(marker);
      expect(at).toBeGreaterThan(-1);
      return page.slice(at, at + length);
    };
    for (const site of [
      from("const handleLoadLatest", 1000),
      from("const handleRefetchTrip", 5000),
      from("onItineraryChange={(next, serverVersion)", 1000),
    ]) {
      expect(site).toContain("sync.reset(");
      expect(site).toContain("clearHistory()");
    }
    for (const locale of ["en", "es", "it", "pt"]) {
      const detail = JSON.parse(read(`messages/${locale}/trips.json`)).detail;
      expect(detail.writeBlockedConflict).toBeTruthy();
      expect(detail.writeBlockedUnsaved).toBeTruthy();
    }
  });

  it("a page restored from the router cache catches up instead of 409ing on its own saves", () => {
    const page = read("app/[locale]/trips/[id]/TripDetailClient.tsx");
    expect(page).toContain("if (known !== null && propsVersion !== null && known > propsVersion) router.refresh();");
    // Newer props are taken as a pair, and never over local edits.
    expect(page).toContain("if (pendingSaveRef.current || hasChangesRef.current || conflictRef.current) return;");
    expect(page).toContain("sync.reset(propsVersion);");
  });

  it("a regenerated day keeps the stored day's date and position", () => {
    const route = read("app/api/ai/regenerate-day/route.ts");
    expect(route).toContain("date: stored.date,");
    expect(route).toContain("day_number: stored.day_number,");
  });
});
