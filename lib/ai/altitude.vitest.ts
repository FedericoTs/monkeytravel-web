/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import type { TripCreationParams } from "@/types";
import { altitudeLine, highPlace } from "./altitude";
import { cachePolicy } from "./cache-policy";

/**
 * A plan for Leh, at 3,500 m, sent a couple up the palace, through a museum and up the stupa's steps from 08:30 on
 * the day they flew in; one for Cusco planned four stops from 09:00. The first day high up is for the height.
 */

const trip = (destination: string, destinations?: Array<{ city: string; nights: number }>) =>
  ({ destination, destinations, startDate: "2026-12-29", endDate: "2027-01-03" }) as TripCreationParams;

describe("highPlace", () => {
  it("knows the high places travellers fly into, however they are written", () => {
    expect(highPlace("Leh")).toEqual({ place: "Leh", metres: 3500 });
    expect(highPlace("Leh, Ladakh, India")?.place).toBe("Leh");
    expect(highPlace("ladakh")?.place).toBe("Leh");
    expect(highPlace("Machu Picchu, Peru")).toEqual({ place: "Cusco", metres: 3400 });
    expect(highPlace("Cuzco")?.place).toBe("Cusco");
    expect(highPlace("La Paz, Bolivia")).toEqual({ place: "La Paz", metres: 3640 });
    expect(highPlace("Potosí, Bolivia")?.place).toBe("Potosí");
    expect(highPlace("Tibet")?.place).toBe("Lhasa");
    expect(highPlace("Quito, Ecuador")).toEqual({ place: "Quito", metres: 2850 });
  });

  it("leaves places by the sea or lower that share a name or a word", () => {
    expect(highPlace("La Paz, Baja California Sur, Mexico")).toBeNull();
    expect(highPlace("San Luis Potosí")).toBeNull();
    expect(highPlace("Kazakhstan")).toBeNull();
    expect(highPlace("Lehigh Valley")).toBeNull();
    expect(highPlace("Lisbon")).toBeNull();
  });
});

describe("altitudeLine", () => {
  it("tells the first day at a high place to rest, with its height and date", () => {
    expect(altitudeLine(trip("Leh"))).toBe(
      "Altitude: Leh is about 3,500 m up, and most visitors arrive from far lower. The first day here (2026-12-29) is for getting used to the height: rest, one short flat walk and an early, light dinner at most; no climbs, treks, high passes or long drives up. Keep the next day gentle too.",
    );
    expect(altitudeLine(trip("Lisbon"))).toBe("");
  });

  it("tells a route's first high city, not one reached from another high city", () => {
    const route = [{ city: "Delhi", nights: 2 }, { city: "Leh", nights: 3 }, { city: "Nubra Valley", nights: 2 }];
    expect(altitudeLine(trip("Delhi", route))).toBe("");
    expect(altitudeLine(trip("Leh", route))).toContain("Leh is about 3,500 m up");
    expect(altitudeLine(trip("Nubra Valley", route))).toBe("");
    // Nubra first on its route: told.
    expect(altitudeLine(trip("Nubra Valley", [{ city: "Nubra Valley", nights: 2 }, { city: "Leh", nights: 2 }]))).toContain("Nubra Valley is about 3,050 m up");
    expect(altitudeLine(trip("Cusco", [{ city: "Lima", nights: 2 }, { city: "Cusco", nights: 3 }]))).toContain("Cusco is about 3,400 m up");
  });

  it("makes the plan one of its own, so a plan from before can't answer the trip from the shared pool", () => {
    expect(cachePolicy(trip("Leh"), false, 5).tailored).toBe(true);
    expect(cachePolicy(trip("Lisbon"), false, 5).tailored).toBe(false);
  });
});
