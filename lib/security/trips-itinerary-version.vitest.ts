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
// The trip page's code: the page, the hook that holds its saves, and the
// hooks that regenerate an activity or a day.
const tripPage = () =>
  [
    "app/[locale]/(app)/trips/[id]/TripDetailClient.tsx",
    "hooks/useItinerarySync.ts",
    "hooks/useActivityRegeneration.ts",
    "hooks/useDayRegeneration.ts",
  ]
    .map(read)
    .join("\n");

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
  it("no phantom first-render edit: one copy for both states, with ids derived from the stored trip", () => {
    const page = tripPage();
    // ensureActivityIds mints random ids: two calls made the page look edited,
    // and each mount / router-cache restore minted different ids.
    expect(page).toContain("const [initialItinerary] = useState(() => ensureActivityIdsStable(trip.itinerary, trip.id));");
    expect(page).not.toMatch(/useState<ItineraryDay\[\]>\(\(\) =>\s*ensureActivityIds\(trip\.itinerary\)/);
    // Every read of a stored copy uses the derived ids; only a regenerated
    // day (ids stamped by the server) goes through the random variant.
    const code = page.split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");
    expect(code.match(/ensureActivityIds\(/g)?.length).toBe(1);
  });

  it("new trips are stored with activity ids, in every creation path that can store id-less days", () => {
    // Both wizard arms insert through persistTrip's row builder.
    expect(read("lib/trips/persistTrip.ts")).toContain("itinerary: ensureActivityIds(itinerary.days),");
    expect(read("lib/trips/wizard-trip-writes.ts")).toContain("{ arm: \"manual\", mountId }");
    expect(read("app/[locale]/(app)/trips/new/NewTripWizard.tsx")).not.toContain(".rpc(\"insert_trip_dedup\"");
    // Anonymous shares are stamped by their validator (which also lets odd shapes through).
    expect(read("lib/trips/anonymous-share.ts")).toContain("itinerary: withActivityIds(b.itinerary),");
    expect(read("app/api/trips/duplicate/route.ts")).toMatch(/itinerary: Array\.isArray\(adjustedItinerary\) \? ensureActivityIds\(/);
    // The wizard gives its own copy ids once, so its insert and every later update carry the same ids.
    const wizard = read("app/[locale]/(app)/trips/new/NewTripWizard.tsx");
    expect(wizard).toContain("return missing ? { ...value, days: ensureActivityIds(value.days) } : value;");
    expect(wizard).toContain("const [generatedItinerary, setGeneratedItineraryRaw] = useState<GeneratedItinerary | null>(null);");
  });
});
