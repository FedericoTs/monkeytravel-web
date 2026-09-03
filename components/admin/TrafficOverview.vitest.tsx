import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import TrafficOverview from "./TrafficOverview";

/**
 * The engaged-sessions line exists to correct a 5x overstatement, so the one
 * thing it must never do is invent a number of its own.
 *
 * `session_engagement` is forward-only from 2026-09-02. Days before that have
 * no value, and rendering them as 0 would draw a collapse that is an artefact
 * of when measurement started rather than anything that happened to the
 * traffic — the same class of artefact that has already cost this dashboard
 * credibility twice (four analytics RPCs silently past the statement timeout,
 * rendering confident zeros).
 */

const day = (date: string, views: number, uniqueVisitors: number, engagedSessions?: number) => ({
  date,
  views,
  uniqueVisitors,
  ...(engagedSessions === undefined ? {} : { engagedSessions }),
});

const withDaily = (daily: ReturnType<typeof day>[]) => ({
  daily,
  bySection: [],
  conversionFunnel: [],
});

describe("TrafficOverview engaged-sessions series", () => {
  it("does not offer the series when no day carries the signal", () => {
    render(
      <TrafficOverview
        data={withDaily([day("2026-08-30", 100, 60), day("2026-08-31", 120, 70)])}
      />
    );
    expect(screen.queryByText("Engaged Sessions")).toBeNull();
    // The raw lines still render — this is an addition, not a replacement.
    expect(screen.getByText("Unique Visitors")).toBeTruthy();
    expect(screen.getByText("Page Views")).toBeTruthy();
  });

  it("offers the series once a day carries it", () => {
    render(
      <TrafficOverview
        data={withDaily([
          day("2026-09-01", 100, 60),
          day("2026-09-02", 120, 70, 6),
          day("2026-09-03", 130, 80, 163),
        ])}
      />
    );
    expect(screen.getByText("Engaged Sessions")).toBeTruthy();
  });

  it("keeps both raw lines alongside it", () => {
    // The unengaged sessions are still real requests that cost money to serve,
    // and "not engaged" is not proof of a bot. Both denominators stay visible.
    render(
      <TrafficOverview
        data={withDaily([day("2026-09-02", 120, 70, 6), day("2026-09-03", 130, 80, 163)])}
      />
    );
    expect(screen.getByText("Page Views")).toBeTruthy();
    expect(screen.getByText("Unique Visitors")).toBeTruthy();
    expect(screen.getByText("Engaged Sessions")).toBeTruthy();
  });

  it("explains that missing days are unmeasured, not zero", () => {
    render(
      <TrafficOverview
        data={withDaily([day("2026-09-02", 120, 70, 6), day("2026-09-03", 130, 80, 163)])}
      />
    );
    const label = screen.getByText("Engaged Sessions");
    const title = label.getAttribute("title") ?? "";
    expect(title).toMatch(/not because it was zero/i);
  });

  it("renders a single engaged day without drawing a line from nothing", () => {
    // One point cannot make a path; the guard is `length > 1`. This must not
    // throw, and must not fabricate a second point.
    expect(() =>
      render(
        <TrafficOverview
          data={withDaily([day("2026-09-02", 120, 70), day("2026-09-03", 130, 80, 163)])}
        />
      )
    ).not.toThrow();
  });
});

describe("the engaged line starts where measurement started", () => {
  /**
   * The geometry is the whole point, and it is what a screenshot of /admin
   * would have shown. Padding.left is 50 and the chart is 800 wide with 20
   * right padding, so a 5-day series places day i at 50 + (i/4)*730.
   */
  const pathFor = (container: HTMLElement, stroke: string) =>
    container.querySelector(`path[stroke="${stroke}"]`)?.getAttribute("d") ?? "";

  const fiveDays = [
    day("2026-08-30", 100, 60),
    day("2026-08-31", 100, 60),
    day("2026-09-01", 100, 60),
    day("2026-09-02", 100, 60, 20),
    day("2026-09-03", 100, 60, 40),
  ];

  it("does not run along the x-axis across unmeasured days", () => {
    const { container } = render(<TrafficOverview data={withDaily(fiveDays)} />);
    const d = pathFor(container, "#f59e0b");
    expect(d).not.toBe("");
    // First point must be day index 3 (50 + 3/4*730 = 597.5), NOT the left
    // padding at 50. Starting at 50 would mean three fabricated zero days.
    const firstX = Number(d.split(" ")[1]);
    expect(firstX).toBeCloseTo(597.5, 1);
  });

  it("stays aligned with the other series", () => {
    const { container } = render(<TrafficOverview data={withDaily(fiveDays)} />);
    const views = pathFor(container, "var(--primary)");
    const engaged = pathFor(container, "#f59e0b");
    // The views line covers every day, so its LAST x and the engaged line's
    // last x must coincide — the partial series must not be re-scaled to fill
    // the full width, which would silently shift it in time.
    const lastX = (d: string) => Number(d.trim().split(" ").slice(-2)[0]);
    expect(lastX(engaged)).toBeCloseTo(lastX(views), 1);
  });

  it("draws nothing when only one day carries the signal", () => {
    const { container } = render(
      <TrafficOverview
        data={withDaily([day("2026-09-02", 100, 60), day("2026-09-03", 100, 60, 40)])}
      />
    );
    // One point is not a line. Drawing a dot-to-nowhere would imply a trend
    // from a single observation.
    expect(container.querySelector('path[stroke="#f59e0b"]')).toBeNull();
  });
});
