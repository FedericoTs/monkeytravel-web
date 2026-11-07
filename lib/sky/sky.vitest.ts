import { describe, expect, it } from "vitest";
import { INK, WHITE, contrast, inkFor, skyAt, skyStops, type Rgb } from "./sky";
import { sunTimes, zoneOffsetMinutes } from "./sun";

const clock = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

describe("sunrise and sunset", () => {
  // Published times for these days, to the minute; the approximation is good to a few.
  it.each([
    ["Paris, longest day", "2027-06-21", 48.8566, 2.3522, "Europe/Paris", "05:47", "21:58"],
    ["Paris, shortest day", "2027-12-21", 48.8566, 2.3522, "Europe/Paris", "08:42", "16:56"],
    ["Tokyo, in June", "2027-06-21", 35.6762, 139.6503, "Asia/Tokyo", "04:25", "19:00"],
    ["Sydney, in its summer", "2027-12-21", -33.8688, 151.2093, "Australia/Sydney", "05:41", "20:05"],
    ["Reykjavik, setting after midnight", "2027-06-21", 64.1466, -21.9426, "Atlantic/Reykjavik", "02:55", "24:03"],
  ])("%s", (_name, date, lat, lng, zone, rise, set) => {
    const sun = sunTimes(date, lat, lng, zone);
    expect(sun.polar).toBeNull();
    expect(Math.abs((sun.sunrise ?? 0) - clock(rise))).toBeLessThanOrEqual(5);
    expect(Math.abs((sun.sunset ?? 0) - clock(set))).toBeLessThanOrEqual(5);
  });

  it("knows the days the sun stays up, and the days it doesn't come up", () => {
    expect(sunTimes("2027-06-21", 69.6492, 18.9553, "Europe/Oslo").polar).toBe("day");
    expect(sunTimes("2027-12-21", 69.6492, 18.9553, "Europe/Oslo").polar).toBe("night");
  });

  it("takes summer time from the date", () => {
    expect(zoneOffsetMinutes("Europe/Paris", "2027-01-15")).toBe(60);
    expect(zoneOffsetMinutes("Europe/Paris", "2027-07-15")).toBe(120);
    expect(zoneOffsetMinutes("America/New_York", "2027-07-15")).toBe(-240);
    expect(zoneOffsetMinutes("Asia/Kolkata", "2027-07-15")).toBe(330);
  });
});

describe("the sky", () => {
  const paris = sunTimes("2027-05-10", 48.8566, 2.3522, "Europe/Paris");
  const stops = skyStops(paris);
  const at = (hhmm: string) => skyAt(stops, clock(hhmm));
  const isNight = (rgb: Rgb) => rgb[0] + rgb[1] + rgb[2] < 120;

  it("is night before dawn and after dusk, and a clear day at noon", () => {
    expect(isNight(at("02:00"))).toBe(true);
    expect(isNight(at("23:59"))).toBe(true);
    const noon = at("13:45");
    expect(noon[2]).toBeGreaterThan(noon[0]);
    expect(noon[2]).toBeGreaterThan(200);
  });

  it("is warm at sunset", () => {
    const sunset = skyAt(stops, paris.sunset!);
    expect(sunset[0]).toBeGreaterThan(sunset[2]);
  });

  it("keeps its moments in order, even on a short winter day", () => {
    for (const sun of [paris, sunTimes("2027-12-21", 60.1699, 24.9384, "Europe/Helsinki"), sunTimes("2027-12-21", 68.4385, 17.4272, "Europe/Oslo")]) {
      const times = skyStops(sun).map(([t]) => t);
      expect(times[0]).toBe(0);
      expect(times[times.length - 1]).toBe(1440);
      for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThan(times[i - 1]);
    }
  });

  it("stays day all day under a midnight sun", () => {
    const allDay = skyStops(sunTimes("2027-06-21", 69.6492, 18.9553, "Europe/Oslo"));
    expect(isNight(skyAt(allDay, clock("00:30")))).toBe(false);
  });

  it("is night before the first moment and after the last", () => {
    expect(skyAt(stops, -30)).toEqual(stops[0][1]);
    expect(skyAt(stops, 1500)).toEqual(stops[stops.length - 1][1]);
  });
});

describe("the words on it", () => {
  it("are dark on a bright sky and light on a dark one", () => {
    expect(inkFor([[169, 220, 249]])).toEqual(INK);
    expect(inkFor([[238, 133, 88]])).toEqual(INK);
    expect(inkFor([[13, 20, 51]])).toEqual(WHITE);
    expect(inkFor([[167, 82, 127]])).toEqual(WHITE);
  });

  it("turn black where neither the ink nor white would read", () => {
    // The dusk colour where the dark ink and white are both under 4.5 to 1.
    const dusk: Rgb = [196, 104, 100];
    expect(contrast(dusk, INK)).toBeLessThan(4.5);
    expect(contrast(dusk, WHITE)).toBeLessThan(4.5);
    expect(inkFor([dusk])).toEqual([0, 0, 0]);
  });

  it("read across a block that spans a bright sky and a dark one", () => {
    const span: Rgb[] = [[169, 220, 249], [13, 20, 51]];
    const ink = inkFor(span);
    const worst = Math.min(...span.map((sky) => contrast(sky, ink)));
    for (const other of [INK, WHITE, [0, 0, 0] as Rgb]) {
      expect(worst).toBeGreaterThanOrEqual(Math.min(...span.map((sky) => contrast(sky, other))));
    }
  });

  it("always read: at least 4.5 to 1, all day long", () => {
    const stops = skyStops(sunTimes("2027-05-10", 48.8566, 2.3522, "Europe/Paris"));
    for (let minute = 0; minute <= 1440; minute += 5) {
      const sky = skyAt(stops, minute);
      expect(contrast(sky, inkFor([sky]))).toBeGreaterThanOrEqual(4.5);
    }
  });
});
