import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveErrorClass } from "@/lib/wizard/save-failure";
import type { PersistInput } from "@/lib/trips/persistTrip";
import { newWizardMountId, wizardTripWrites } from "./wizard-trip-writes";

/**
 * The wizard's writes: who a trip is saved for, and what it records about the
 * save, so a duplicate row can be traced to its cause.
 */

const persist = vi.hoisted(() => ({
  insertTrip: vi.fn(async () => ({ tripId: "trip-1", durationDays: 3 })),
  updateTrip: vi.fn(async () => {}),
  deleteTrip: vi.fn(async () => {}),
  attachCoverImage: vi.fn(async () => {}),
}));
vi.mock("@/lib/trips/persistTrip", () => persist);

const auth = vi.hoisted(() => ({ getSession: vi.fn(), getUser: vi.fn() }));
const client = vi.hoisted(() => ({ auth: {} as unknown }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => client }));

const input = { itinerary: { days: [] }, formState: { destination: "Paris" } } as unknown as PersistInput;
const writes = wizardTripWrites("mount-1");

beforeEach(() => {
  client.auth = auth;
  auth.getSession.mockResolvedValue({ data: { session: { user: { id: "from-session" } } } });
  auth.getUser.mockResolvedValue({ data: { user: { id: "from-network" } } });
});
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("the auto-save's insert", () => {
  it("saves for the local session's user, marked as this mount's automatic save", async () => {
    await expect(writes.saveTrip(input)).resolves.toEqual({ tripId: "trip-1", durationDays: 3 });
    expect(persist.insertTrip).toHaveBeenCalledWith(client, input, "from-session", { arm: "auto", mountId: "mount-1" });
  });

  it("doesn't ask the network who is signed in, so an auth hiccup can't fail a save", async () => {
    auth.getUser.mockRejectedValue(new Error("auth hiccup"));
    await writes.saveTrip(input);
    expect(auth.getUser).not.toHaveBeenCalled();
  });

  it("with no session writes nothing, and fails in a way the dashboards chart as network", async () => {
    auth.getSession.mockResolvedValue({ data: { session: null } });
    const failure = await writes.saveTrip(input).catch((e: Error) => e);
    expect(failure).toBeInstanceOf(Error);
    expect(saveErrorClass((failure as Error).message)).toBe("network");
    expect(persist.insertTrip).not.toHaveBeenCalled();
  });
});

describe("the manual save's insert", () => {
  it("saves for the user it is given, marked as this mount's manual save", async () => {
    await expect(writes.saveTripManually(input, "user-9")).resolves.toEqual({ tripId: "trip-1", durationDays: 3 });
    expect(persist.insertTrip).toHaveBeenCalledWith(client, input, "user-9", { arm: "manual", mountId: "mount-1" });
    expect(auth.getSession).not.toHaveBeenCalled();
  });
});

describe("the update", () => {
  it("writes for the user the server confirms", async () => {
    await writes.updateTrip("trip-1", input);
    expect(persist.updateTrip).toHaveBeenCalledWith(client, "trip-1", input, "from-network");
  });

  it("with nobody signed in writes nothing", async () => {
    auth.getUser.mockResolvedValue({ data: { user: null } });
    await expect(writes.updateTrip("trip-1", input)).rejects.toThrow("Not authenticated");
    expect(persist.updateTrip).not.toHaveBeenCalled();
  });
});

describe("the rest", () => {
  it("deletes the trip it is given", async () => {
    await writes.deleteTrip("trip-1");
    expect(persist.deleteTrip).toHaveBeenCalledWith(client, "trip-1");
  });

  it("attaches a cover to the trip it is given", async () => {
    await writes.attachCoverImage("trip-1", "Paris");
    expect(persist.attachCoverImage).toHaveBeenCalledWith(client, "trip-1", "Paris");
  });
});

describe("a mount's id", () => {
  it("is a fresh id each time", () => {
    expect(newWizardMountId()).not.toBe(newWizardMountId());
  });

  it("still comes out unique on a browser without randomUUID", () => {
    vi.stubGlobal("crypto", {});
    const id = newWizardMountId();
    expect(id).toMatch(/^m_[a-z0-9]+_[a-z0-9]+$/);
    expect(id).not.toBe(newWizardMountId());
  });
});
