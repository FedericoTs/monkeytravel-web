import { describe, expect, it } from "vitest";
import { colorAtY, skyGradient, timeAtY, type Anchor, type Span } from "./layout";
import { contrast, inkFor, skyAt, skyStops, type Rgb } from "./sky";
import type { SunTimes } from "./sun";

describe("where a moment sits on the page", () => {
  const points = [
    { y: 0, t: 600 },
    { y: 100, t: 700 },
    { y: 300, t: 1300 },
  ];

  it("is in between the moments placed around it", () => {
    expect(timeAtY(points, 50)).toBe(650);
    expect(timeAtY(points, 200)).toBe(1000);
  });

  it("holds the first and last moments beyond them", () => {
    expect(timeAtY(points, -20)).toBe(600);
    expect(timeAtY(points, 900)).toBe(1300);
  });

  it("takes the later of two moments that share a height", () => {
    expect(timeAtY([{ y: 0, t: 0 }, { y: 100, t: 60 }, { y: 100, t: 90 }], 100)).toBe(90);
  });
});

describe("the colour at a height", () => {
  const stops = [
    { y: 0, color: [0, 0, 0] as Rgb },
    { y: 100, color: [100, 200, 50] as Rgb },
  ];

  it("blends the stops around it, as the browser does", () => {
    expect(colorAtY(stops, 25)).toEqual([25, 50, 12.5]);
  });

  it("holds the first and last stops beyond them", () => {
    expect(colorAtY(stops, -5)).toEqual([0, 0, 0]);
    expect(colorAtY(stops, 140)).toEqual([100, 200, 50]);
  });
});

describe("the sky behind the plan", () => {
  const page: Rgb = [1, 2, 3];
  // A sky that changes by a step every four minutes, so a colour says which moment it is.
  const ramp = (t: number): Rgb => [t / 4, 255 - t / 4, 128];
  const drawn = (anchors: Anchor[], words: Span[] = []) => skyGradient({ anchors, words, height: 1000, colorAt: ramp, turns: [], page }).stops;

  it("draws a block of words in one light, the light where it starts", () => {
    const stops = drawn([{ y: 0, t: 600 }, { y: 300, t: 1000 }], [{ top: 100, bottom: 200 }]);
    for (const y of [100, 150, 200]) expect(colorAtY(stops, y)).toEqual(ramp(800));
  });

  it("lets time pass only where there are no words", () => {
    const stops = drawn([{ y: 0, t: 600 }, { y: 300, t: 1000 }], [{ top: 100, bottom: 200 }]);
    expect(colorAtY(stops, 50)).toEqual(ramp(700));
    expect(colorAtY(stops, 250)).toEqual(ramp(900));
  });

  it("reads lines close together as one block, in the light where it starts", () => {
    // A stop without a photo: its name, then the words about it 10 px below, where the moment it ends is placed.
    const stops = drawn([{ y: 0, t: 600 }, { y: 100, t: 700 }, { y: 160, t: 760 }, { y: 400, t: 1000 }], [{ top: 100, bottom: 150 }, { top: 160, bottom: 200 }]);
    expect(colorAtY(stops, 120)).toEqual(ramp(700));
    expect(colorAtY(stops, 190)).toEqual(ramp(700));
  });

  it("gives blocks further apart their own light", () => {
    // A stop with a photo between its name and the words about it.
    const stops = drawn([{ y: 0, t: 600 }, { y: 100, t: 700 }, { y: 180, t: 760 }, { y: 400, t: 1000 }], [{ top: 100, bottom: 150 }, { top: 180, bottom: 220 }]);
    expect(colorAtY(stops, 120)).toEqual(ramp(700));
    expect(colorAtY(stops, 200)).toEqual(ramp(760));
  });

  it("never goes back in time down the page", () => {
    const stops = drawn([{ y: 0, t: 600 }, { y: 100, t: 900 }, { y: 200, t: 700 }, { y: 300, t: 1000 }]);
    expect(colorAtY(stops, 150)).toEqual(ramp(900));
  });

  it("turns colour exactly where the sky does, not only where the plan has a moment", () => {
    const peak: Array<[number, Rgb]> = [
      [0, [0, 0, 0]],
      [700, [255, 255, 255]],
      [1440, [0, 0, 0]],
    ];
    const { stops, background } = skyGradient({
      anchors: [{ y: 0, t: 600 }, { y: 200, t: 800 }],
      words: [],
      height: 400,
      colorAt: (t) => skyAt(peak, t),
      turns: peak.map(([t]) => t),
      page,
    });
    expect(colorAtY(stops, 100)).toEqual([255, 255, 255]);
    expect(background).toContain("rgb(255 255 255) 100px");

    // With a block of words above it, the turn moves down past the block.
    const below = skyGradient({
      anchors: [{ y: 0, t: 600 }, { y: 300, t: 800 }],
      words: [{ top: 50, bottom: 150 }],
      height: 500,
      colorAt: (t) => skyAt(peak, t),
      turns: peak.map(([t]) => t),
      page,
    });
    expect(colorAtY(below.stops, 200)).toEqual([255, 255, 255]);
  });

  it("ends on the page's own colour, so what follows the plan isn't on the sky", () => {
    const { background } = skyGradient({ anchors: [{ y: 0, t: 600 }, { y: 400, t: 900 }], words: [], height: 1000, colorAt: ramp, turns: [], page });
    expect(background.startsWith("linear-gradient(to bottom, ")).toBe(true);
    expect(background.endsWith("rgb(1 2 3) 1000px)")).toBe(true);
  });

  describe("stars", () => {
    const day: Rgb = [169, 220, 249];
    const night: Rgb = [13, 20, 51];
    const dayThenNight = (t: number): Rgb => (t < 1200 ? day : night);

    it("marks the dark stretches, and only those", () => {
      const { nights } = skyGradient({
        anchors: [{ y: 0, t: 600 }, { y: 400, t: 1100 }, { y: 800, t: 1400 }],
        words: [],
        height: 1600,
        colorAt: dayThenNight,
        turns: [1200],
        page,
      });
      expect(nights.length).toBe(1);
      expect(nights[0].top).toBeGreaterThan(400);
      expect(nights[0].top).toBeLessThan(800);
    });

    it("has none on a plan that ends before dark", () => {
      const { nights } = skyGradient({ anchors: [{ y: 0, t: 600 }, { y: 500, t: 1000 }], words: [], height: 900, colorAt: dayThenNight, turns: [1200], page });
      expect(nights).toEqual([]);
    });
  });

  it("lets every block of words read at 4.5 to 1, whatever the days and the layout", () => {
    let seed = 7;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const days: SunTimes[] = [
      { sunrise: 390, sunset: 1170, polar: null },
      { sunrise: 290, sunset: 1325, polar: null },
      { sunrise: 525, sunset: 1012, polar: null },
      { sunrise: 175, sunset: 1443, polar: null },
      { sunrise: null, sunset: null, polar: "night" },
      { sunrise: null, sunset: null, polar: "day" },
    ];
    let blocks = 0;
    for (let run = 0; run < 300; run++) {
      const skies = [0, 1, 2].map(() => skyStops(days[Math.floor(random() * days.length)]));
      const colorAt = (t: number) => {
        const i = Math.min(Math.max(Math.floor(t / 1440), 0), skies.length - 1);
        return skyAt(skies[i], t - i * 1440);
      };
      const turns = skies.flatMap((stops, i) => stops.map(([minutes]) => i * 1440 + minutes));
      // Three days of moments, each opening a block of words of any height, some with a moment in the space after it.
      const anchors: Anchor[] = [];
      const words: Span[] = [];
      let y = 0;
      let t = 300 + random() * 400;
      while (t < 3 * 1440) {
        anchors.push({ y, t });
        const height = 18 + random() * 320;
        words.push({ top: y, bottom: y + height });
        const gap = random() * 80;
        if (random() < 0.4) anchors.push({ y: y + height + gap / 2, t: t + (random() - 0.3) * 200 });
        y += height + gap;
        t += random() * 260;
      }
      const { stops } = skyGradient({ anchors, words, height: y + 300, colorAt, turns, page: [248, 250, 252] });
      for (const { top, bottom } of words) {
        const behind = [top, (top + bottom) / 2, bottom].map((h) => colorAtY(stops, h));
        const ink = inkFor(behind);
        expect(Math.min(...behind.map((sky) => contrast(sky, ink)))).toBeGreaterThanOrEqual(4.5);
        blocks++;
      }
    }
    expect(blocks).toBeGreaterThan(3000);
  });
});
