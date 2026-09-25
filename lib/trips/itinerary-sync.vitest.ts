// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { createItinerarySync, latestKnownVersion, readItineraryVersion, sameItineraryIgnoringPhotos } from "./itinerary-sync";

/**
 * The tab's save queue. The version check is only worth having if a tab can
 * never trip it on itself: saves strictly one after another, each carrying
 * the version the previous reply returned, never aborted.
 */

const day = (name: string, extra: Record<string, unknown> = {}) => [
  { day_number: 1, date: "2027-01-01", activities: [{ id: "a1", name, ...extra }] },
];

function jsonResponse(status: number, body: unknown, delayMs = 0) {
  return new Promise<Response>((resolve) =>
    setTimeout(() => resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })), delayMs)
  );
}

describe("send", () => {
  it("carries the base version, and adopts nothing on its own", async () => {
    const fetchImpl = vi.fn(() => jsonResponse(200, { success: true, trip: { itinerary_version: 5 } }));
    const sync = createItinerarySync({ tripId: "t1", initialVersion: 4, fetchImpl: fetchImpl as unknown as typeof fetch });
    const result = await sync.enqueue(() => sync.send(JSON.stringify(day("x")), sync.baseVersion()));
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/trips/t1");
    expect(JSON.parse(String(init.body)).baseItineraryVersion).toBe(4);
    expect(init.signal).toBeUndefined();
    expect(result).toEqual({ kind: "saved", version: 5 });
    expect(sync.baseVersion()).toBe(4); // the caller adopts, together with the content
  });

  it("omits the base when the page had none (older server)", async () => {
    const fetchImpl = vi.fn(() => jsonResponse(200, { trip: {} }));
    const sync = createItinerarySync({ tripId: "t1", initialVersion: null, fetchImpl: fetchImpl as unknown as typeof fetch });
    const result = await sync.send(JSON.stringify(day("x")), sync.baseVersion());
    const body = JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect("baseItineraryVersion" in body).toBe(false);
    expect(result).toEqual({ kind: "saved", version: null });
  });

  it("reports a real conflict with the server's itinerary and version", async () => {
    const server = day("Someone else's edit");
    const fetchImpl = vi.fn(() => jsonResponse(409, { code: "ITINERARY_CONFLICT", itinerary: server, itineraryVersion: 7 }));
    const sync = createItinerarySync({ tripId: "t1", initialVersion: 4, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(await sync.send(JSON.stringify(day("mine")), sync.baseVersion())).toEqual({ kind: "conflict", server: { itinerary: server, version: 7 } });
  });

  it("treats a 409 that already holds exactly this edit as saved (photos and key order ignored)", async () => {
    const mine = [{ day_number: 1, date: "2027-01-01", activities: [{ name: "Same", id: "a1" }] }];
    const server = [{ activities: [{ id: "a1", name: "Same", image_url: "https://x/p.jpg" }], date: "2027-01-01", day_number: 1 }];
    const fetchImpl = vi.fn(() => jsonResponse(409, { code: "ITINERARY_CONFLICT", itinerary: server, itineraryVersion: 6 }));
    const sync = createItinerarySync({ tripId: "t1", initialVersion: 5, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(await sync.send(JSON.stringify(mine), 5)).toEqual({ kind: "saved", version: 6 });
  });

  it("fails cleanly on a network error or a server error", async () => {
    const down = createItinerarySync({ tripId: "t1", initialVersion: 1, fetchImpl: (() => Promise.reject(new Error("offline"))) as unknown as typeof fetch });
    expect(await down.send(JSON.stringify(day("x")), 1)).toEqual({ kind: "failed", status: null });
    const broken = createItinerarySync({ tripId: "t1", initialVersion: 1, fetchImpl: (() => jsonResponse(500, { error: "x" })) as unknown as typeof fetch });
    expect(await broken.send(JSON.stringify(day("x")), 1)).toEqual({ kind: "failed", status: 500 });
    const forbidden = createItinerarySync({ tripId: "t1", initialVersion: 1, fetchImpl: (() => jsonResponse(403, { error: "no" })) as unknown as typeof fetch });
    expect(await forbidden.send(JSON.stringify(day("x")), 1)).toEqual({ kind: "failed", status: 403 });
  });
});

describe("the base a save carries", () => {
  it("is the one given with the payload, even if the tab's base moved while it waited", async () => {
    // A day regeneration queued ahead adopted v8; this payload was built on v7
    // and must not pass the check as if it contained the regenerated day.
    const fetchImpl = vi.fn(() => jsonResponse(200, { trip: { itinerary_version: 9 } }));
    const sync = createItinerarySync({ tripId: "t1", initialVersion: 7, fetchImpl: fetchImpl as unknown as typeof fetch });
    const payload = JSON.stringify(day("built on v7"));
    const base = sync.baseVersion();
    sync.adopt(8);
    await sync.send(payload, base);
    expect(JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body)).baseItineraryVersion).toBe(7);
  });
});

describe("a save whose reply was lost", () => {
  const conflictWith = (itinerary: unknown, version: number) =>
    jsonResponse(409, { code: "ITINERARY_CONFLICT", itinerary, itineraryVersion: version });

  it("landed anyway: the next edit is sent again on top of it instead of a false conflict", async () => {
    const p1 = day("first edit");
    const p2 = day("first edit, then more");
    const bases: Array<number | undefined> = [];
    const replies = [
      () => Promise.reject(new Error("connection reset")), // P1 committed as v6, reply lost
      () => conflictWith(p1, 6), // P2 on v5: the server holds P1
      () => jsonResponse(200, { trip: { itinerary_version: 7 } }), // P2 on v6
    ];
    const fetchImpl = vi.fn((_url: string, init: RequestInit) => {
      bases.push(JSON.parse(String(init.body)).baseItineraryVersion);
      return replies.shift()!();
    });
    const sync = createItinerarySync({ tripId: "t1", initialVersion: 5, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(await sync.send(JSON.stringify(p1), 5)).toEqual({ kind: "failed", status: null });
    expect(await sync.send(JSON.stringify(p2), 5)).toEqual({ kind: "saved", version: 7 });
    expect(bases).toEqual([5, 5, 6]);
  });

  it("also after a gateway 5xx", async () => {
    const p1 = day("first edit");
    const replies = [
      () => jsonResponse(504, { error: "timeout" }),
      () => conflictWith(p1, 6),
      () => jsonResponse(200, { trip: { itinerary_version: 7 } }),
    ];
    const fetchImpl = vi.fn(() => replies.shift()!());
    const sync = createItinerarySync({ tripId: "t1", initialVersion: 5, fetchImpl: fetchImpl as unknown as typeof fetch });
    await sync.send(JSON.stringify(p1), 5);
    expect(await sync.send(JSON.stringify(day("more")), 5)).toEqual({ kind: "saved", version: 7 });
  });

  it("a trip mate's newer version is still a conflict", async () => {
    const replies = [() => Promise.reject(new Error("offline")), () => conflictWith(day("their edit"), 6)];
    const fetchImpl = vi.fn(() => replies.shift()!());
    const sync = createItinerarySync({ tripId: "t1", initialVersion: 5, fetchImpl: fetchImpl as unknown as typeof fetch });
    await sync.send(JSON.stringify(day("mine")), 5);
    expect((await sync.send(JSON.stringify(day("mine, more")), 5)).kind).toBe("conflict");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("a 4xx is a definite no: never taken for a write that landed", async () => {
    const p1 = day("rejected");
    const replies = [() => jsonResponse(400, { error: "bad" }), () => conflictWith(p1, 6)];
    const fetchImpl = vi.fn(() => replies.shift()!());
    const sync = createItinerarySync({ tripId: "t1", initialVersion: 5, fetchImpl: fetchImpl as unknown as typeof fetch });
    await sync.send(JSON.stringify(p1), 5);
    expect((await sync.send(JSON.stringify(day("next")), 5)).kind).toBe("conflict");
  });

  it("a 200 whose body was cut is an unknown outcome, so the next edit rebases on it", async () => {
    const p1 = day("saved, reply cut");
    const replies = [
      () => Promise.resolve(new Response("{\"success\":true,\"trip\":{\"itin", { status: 200 })),
      () => conflictWith(p1, 6),
      () => jsonResponse(200, { trip: { itinerary_version: 7 } }),
    ];
    const fetchImpl = vi.fn(() => replies.shift()!());
    const sync = createItinerarySync({ tripId: "t1", initialVersion: 5, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(await sync.send(JSON.stringify(p1), 5)).toEqual({ kind: "failed", status: null });
    expect(await sync.send(JSON.stringify(day("more")), 5)).toEqual({ kind: "saved", version: 7 });
  });

  it("is forgotten on reset (Load latest)", async () => {
    const p1 = day("lost");
    const replies = [() => Promise.reject(new Error("offline")), () => conflictWith(p1, 9)];
    const fetchImpl = vi.fn(() => replies.shift()!());
    const sync = createItinerarySync({ tripId: "t1", initialVersion: 5, fetchImpl: fetchImpl as unknown as typeof fetch });
    await sync.send(JSON.stringify(p1), 5);
    sync.reset(8);
    expect((await sync.send(JSON.stringify(day("next")), 8)).kind).toBe("conflict");
  });
});

describe("the queue", () => {
  it("runs saves strictly one after another, each on the previous reply's version", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    let serverVersion = 10;
    const sentBases: number[] = [];
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      sentBases.push(JSON.parse(String(init.body)).baseItineraryVersion);
      const res = await jsonResponse(200, { trip: { itinerary_version: ++serverVersion } }, 20);
      inFlight--;
      return res;
    });
    const sync = createItinerarySync({ tripId: "t1", initialVersion: 10, fetchImpl: fetchImpl as unknown as typeof fetch });
    const save = (name: string) =>
      sync.enqueue(async () => {
        const r = await sync.send(JSON.stringify(day(name)), sync.baseVersion());
        if (r.kind === "saved" && r.version !== null) sync.adopt(r.version);
        return r;
      });
    await Promise.all([save("a"), save("b"), save("c")]);
    expect(maxInFlight).toBe(1);
    expect(sentBases).toEqual([10, 11, 12]);
    expect(sync.baseVersion()).toBe(13);
  });

  it("makes a task wait for a save already in flight", async () => {
    const order: string[] = [];
    const fetchImpl = vi.fn(async () => {
      order.push("save-start");
      const r = await jsonResponse(200, { trip: { itinerary_version: 2 } }, 30);
      order.push("save-end");
      return r;
    });
    const sync = createItinerarySync({ tripId: "t1", initialVersion: 1, fetchImpl: fetchImpl as unknown as typeof fetch });
    const saving = sync.enqueue(() => sync.send(JSON.stringify(day("x")), sync.baseVersion()));
    const task = sync.enqueue(async () => {
      order.push("task");
    });
    await Promise.all([saving, task]);
    expect(order).toEqual(["save-start", "save-end", "task"]);
  });

  it("keeps going after a task throws", async () => {
    const sync = createItinerarySync({ tripId: "t1", initialVersion: 1 });
    await expect(sync.enqueue(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    await expect(sync.enqueue(async () => "next")).resolves.toBe("next");
  });
});

describe("versions", () => {
  it("adopt only moves forward; reset sets it outright", () => {
    const sync = createItinerarySync({ tripId: "t1", initialVersion: 5 });
    expect(sync.adopt(4)).toBe(false);
    expect(sync.adopt(5)).toBe(false);
    expect(sync.adopt(6)).toBe(true);
    expect(sync.baseVersion()).toBe(6);
    sync.reset(3);
    expect(sync.baseVersion()).toBe(3);
  });

  it("the epoch moves on a server write the tab started and on reset, never on its own saves", () => {
    const sync = createItinerarySync({ tripId: "t1", initialVersion: 5 });
    const e0 = sync.epoch();
    sync.adopt(6); // this tab's autosave landed: later edits are built on top of it
    expect(sync.epoch()).toBe(e0);
    expect(sync.adoptWrite(6)).toBe(false); // not newer: nothing moves
    expect(sync.epoch()).toBe(e0);
    expect(sync.adoptWrite(7)).toBe(true); // a regenerated day: pending edits lack it
    expect(sync.baseVersion()).toBe(7);
    const e1 = sync.epoch();
    expect(e1).not.toBe(e0);
    sync.reset(9); // Load latest / a refetched copy
    expect(sync.epoch()).not.toBe(e1);
  });

  it("remembers per trip the newest version any page in this tab held (router-cache restores)", () => {
    const first = createItinerarySync({ tripId: "remember-me", initialVersion: 5 });
    first.adopt(12);
    // The page is left and restored from the router cache with its old props.
    const restored = createItinerarySync({ tripId: "remember-me", initialVersion: 5 });
    expect(restored.baseVersion()).toBe(5);
    expect(latestKnownVersion("remember-me")).toBe(12);
    expect(latestKnownVersion("never-opened")).toBeNull();
  });

  it("an unversioned page adopts the first version it is given", () => {
    const sync = createItinerarySync({ tripId: "t1", initialVersion: null });
    expect(sync.adopt(0)).toBe(true);
    expect(sync.baseVersion()).toBe(0);
  });

  it("reads only non-negative integers", () => {
    expect(readItineraryVersion(3)).toBe(3);
    expect(readItineraryVersion(0)).toBe(0);
    for (const bad of [-1, 1.5, "3", null, undefined, NaN]) expect(readItineraryVersion(bad)).toBeNull();
  });
});

describe("sameItineraryIgnoringPhotos", () => {
  it("ignores photos and key order, nothing else", () => {
    expect(sameItineraryIgnoringPhotos(day("x"), day("x", { image_url: "https://p" }))).toBe(true);
    expect(sameItineraryIgnoringPhotos(day("x"), day("y"))).toBe(false);
    expect(sameItineraryIgnoringPhotos(day("x", { note: 1 }), day("x"))).toBe(false);
  });
});
