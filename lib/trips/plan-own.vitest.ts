import { afterEach, describe, expect, it, vi } from "vitest";
import { likeThisDays, planOwnHref, reportPlanOwnClicked } from "./plan-own";

describe("likeThisDays", () => {
  it("is the trip's length on the public page", () => {
    expect(likeThisDays(undefined, "Lisbon", 1)).toBe(1);
    expect(likeThisDays(undefined, "Lisbon", 14)).toBe(14);
  });

  it.each([
    ["on a share link", "token", "Lisbon", 3],
    ["for several cities, which the wizard's ?days= doesn't take", undefined, "Lisbon & Porto", 3],
    ["for a trip without days", undefined, "Lisbon", 0],
    ["past the wizard's longest trip", undefined, "Lisbon", 15],
  ])("is null %s", (_name, token, destination, days) => {
    expect(likeThisDays(token, destination, days)).toBeNull();
  });
});

describe("planOwnHref", () => {
  it("carries the place, and the owner's code for the signup", () => {
    expect(planOwnHref({ destination: "Lisbon", days: null, referralCode: "OWNER1" })).toBe("/trips/new?destination=Lisbon&ref=OWNER1");
  });

  it("carries the length, and where it came from, for a trip like this one", () => {
    expect(planOwnHref({ destination: "Lisbon", days: 3, referralCode: null })).toBe("/trips/new?destination=Lisbon&days=3&from=trip");
  });

  it("escapes the place", () => {
    expect(planOwnHref({ destination: "São Paulo & Rio", days: null, referralCode: null })).toBe(
      "/trips/new?destination=S%C3%A3o+Paulo+%26+Rio"
    );
  });

  it("is the plain wizard with nothing to carry", () => {
    expect(planOwnHref({ destination: "", days: null, referralCode: null })).toBe("/trips/new");
  });
});

describe("reportPlanOwnClicked", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends the click so that it survives the navigation", () => {
    const send = vi.fn(async () => new Response());
    vi.stubGlobal("fetch", send);
    reportPlanOwnClicked({ tripId: "trip-1", destination: "Lisbon", referralCode: "OWNER1", surface: "public_top" });
    expect(send).toHaveBeenCalledExactlyOnceWith("/api/funnel-event", expect.objectContaining({ method: "POST", keepalive: true }));
    const [, init] = send.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      event_type: "plan_own_clicked",
      trip_id: "trip-1",
      destination: "Lisbon",
      referral_code: "OWNER1",
      surface: "public_top",
    });
  });

  it("leaves out what it doesn't have", () => {
    const send = vi.fn(async () => new Response());
    vi.stubGlobal("fetch", send);
    reportPlanOwnClicked({ tripId: "trip-1", destination: "", referralCode: null, surface: "bottom_bar" });
    const [, init] = send.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ event_type: "plan_own_clicked", trip_id: "trip-1", surface: "bottom_bar" });
  });

  it("never gets in the way of the link", () => {
    vi.stubGlobal("fetch", () => {
      throw new Error("offline");
    });
    expect(() => reportPlanOwnClicked({ tripId: "trip-1", destination: "Lisbon", referralCode: null, surface: "bottom_bar" })).not.toThrow();
  });
});
