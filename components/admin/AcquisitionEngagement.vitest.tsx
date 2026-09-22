/**
 * The acquisition panel reads first-party SESSION entries, not GA4 and not
 * page views. Three things it must keep doing, because each one was a
 * decision rather than an accident:
 *
 *   1. hide the "to wizard" percentage on channels too small to carry one —
 *      ai_assistant was 22 sessions when this was built, and "50% to wizard"
 *      off 22 sessions reads like a finding when it is noise;
 *   2. show "internal" as a visible measurement gap rather than folding it
 *      into Direct, which it would inflate by about a fifth;
 *   3. drop our own dev/preview traffic.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import AcquisitionEngagement from "./AcquisitionEngagement";

afterEach(cleanup);

const engagement = {
  dau: 10,
  wau: 40,
  mau: 100,
  stickinessPct: 25,
  timeToFirstTrip: {
    avgHours: 2,
    medianHours: 1,
    usersCount: 5,
    within1h: 2,
    within24h: 4,
    within7d: 5,
  },
};

const channels = [
  { channel: "direct", entrySessions: 5127, reachedWizard: 658, wizardPct: 12.8, sharePct: 51.5 },
  { channel: "internal", entrySessions: 2265, reachedWizard: 873, wizardPct: 38.5, sharePct: 22.7 },
  { channel: "google", entrySessions: 2220, reachedWizard: 862, wizardPct: 38.8, sharePct: 22.3 },
  { channel: "ai_assistant", entrySessions: 22, reachedWizard: 11, wizardPct: 50, sharePct: 0.2 },
  { channel: "dev", entrySessions: 400, reachedWizard: 100, wizardPct: 25, sharePct: 4 },
];

function renderPanel() {
  return render(
    <AcquisitionEngagement
      acquisition={{ channels, windowDays: 28 }}
      engagement={engagement}
    />
  );
}

describe("AcquisitionEngagement", () => {
  it("counts sessions over the stated window, not page views", () => {
    // next-intl-free component, but the subtitle interpolates three values,
    // so React splits it across text nodes and getByText cannot see it whole.
    const { container } = renderPanel();
    const text = container.textContent ?? "";
    // 5127 + 2265 + 2220 + 22, with dev excluded.
    expect(text).toContain("9,634 sessions, last 28 days");
    expect(text).toContain("no consent gate");
  });

  it("drops our own dev and preview traffic", () => {
    const { container } = renderPanel();
    expect(container.textContent).not.toContain("Dev/Preview");
  });

  it("names internal as an unattributed continuation, not Direct", () => {
    renderPanel();
    expect(screen.getByText("Continuation (unattributed)")).toBeTruthy();
    // Direct keeps its own row and its own count.
    expect(screen.getByText("Direct")).toBeTruthy();
  });

  it("shows the wizard rate only where the sample can carry it", () => {
    const { container } = renderPanel();
    expect(container.textContent).toContain("38.8% to wizard"); // google, 2,220 sessions
    expect(container.textContent).toContain("12.8% to wizard"); // direct, 5,127 sessions
    expect(container.textContent).not.toContain("50% to wizard"); // ai_assistant, 22 sessions
  });

  it("renders nothing rather than a misleading empty chart", () => {
    render(
      <AcquisitionEngagement
        acquisition={{ channels: [], windowDays: 28 }}
        engagement={engagement}
      />
    );
    expect(screen.getByText("No acquisition data yet")).toBeTruthy();
  });
});
