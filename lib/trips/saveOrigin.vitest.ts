import { describe, it, expect, vi } from "vitest";
import { insertTrip } from "./persistTrip";
import type { PersistInput } from "./persistTrip";

/**
 * Guards the provenance marker written into trip_meta.
 *
 * Why it needs a test at all: the marker exists to diagnose duplicate trips,
 * and a diagnostic that silently stops being written is worse than none — the
 * next investigation would read its absence as evidence rather than as a
 * regression. The previous way of telling the arms apart (whether
 * trip_meta.destination happened to be present) was exactly that kind of
 * accident, and it is what these keys replace.
 *
 * Asserts against the row actually handed to insert_trip_dedup, so it fails if
 * someone rebuilds the row and drops the keys.
 */

function fakeSupabase() {
  const single = vi.fn().mockResolvedValue({
    data: { trip_id: "trip-1", reused: false },
    error: null,
  });
  const rpc = vi.fn().mockReturnValue({ single });
  return { client: { rpc } as never, rpc };
}

const INPUT = {
  itinerary: {
    destination: { name: "Dubrovnik", description: "Old town", weather_note: "", best_for: [] },
    // pickFallbackCoverImage walks day.activities looking for a photo.
    days: [{ day: 1, activities: [] }],
    trip_summary: {
      total_estimated_cost: 900,
      currency: "EUR",
      highlights: [],
      packing_suggestions: [],
    },
    booking_links: {},
  },
  formState: {
    destination: "Dubrovnik, Croatia",
    startDate: "2026-09-25",
    endDate: "2026-09-29",
    derivedInterests: [],
    travelStyle: "classic",
  },
} as unknown as PersistInput;

/** The jsonb row the RPC was called with. */
function rowFrom(rpc: ReturnType<typeof fakeSupabase>["rpc"]) {
  return rpc.mock.calls[0][1].p_row as Record<string, unknown>;
}

describe("SaveOrigin marker", () => {
  it("records the auto arm and its wizard mount", async () => {
    const { client, rpc } = fakeSupabase();
    await insertTrip(client, INPUT, "user-1", { arm: "auto", mountId: "mount-abc" });
    const meta = rowFrom(rpc).trip_meta as Record<string, unknown>;
    expect(meta.save_arm).toBe("auto");
    expect(meta.wizard_mount_id).toBe("mount-abc");
  });

  it("records the manual arm too — the marker is not auto-only", async () => {
    const { client, rpc } = fakeSupabase();
    await insertTrip(client, INPUT, "user-1", { arm: "manual", mountId: "mount-xyz" });
    const meta = rowFrom(rpc).trip_meta as Record<string, unknown>;
    expect(meta.save_arm).toBe("manual");
  });

  it("omits the mount id rather than writing a null when it is unavailable", async () => {
    // Older Safari / SSR paths may have no id. An absent key reads cleanly in
    // SQL; a null one looks like a value that failed to compute.
    const { client, rpc } = fakeSupabase();
    await insertTrip(client, INPUT, "user-1", { arm: "auto", mountId: null });
    const meta = rowFrom(rpc).trip_meta as Record<string, unknown>;
    expect(meta.save_arm).toBe("auto");
    expect("wizard_mount_id" in meta).toBe(false);
  });

  it("stays backwards compatible when no origin is passed", async () => {
    // Other callers of insertTrip must keep working untouched.
    const { client, rpc } = fakeSupabase();
    await insertTrip(client, INPUT, "user-1");
    const meta = rowFrom(rpc).trip_meta as Record<string, unknown>;
    expect("save_arm" in meta).toBe(false);
    expect("wizard_mount_id" in meta).toBe(false);
  });

  it("does not disturb the metadata the row already carried", async () => {
    // destination is load-bearing: getTripDestination() prefers it over
    // title-stripping. The marker must be additive.
    const { client, rpc } = fakeSupabase();
    await insertTrip(client, INPUT, "user-1", { arm: "auto", mountId: "m" });
    const meta = rowFrom(rpc).trip_meta as Record<string, unknown>;
    expect(meta.destination).toBe("Dubrovnik, Croatia");
  });
});
