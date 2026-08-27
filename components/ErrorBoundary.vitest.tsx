import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { render, screen } from "@testing-library/react";
import ErrorBoundary from "./ErrorBoundary";

const reportBoundaryError = vi.hoisted(() => vi.fn());

vi.mock("@/lib/observability/report-boundary-error", () => ({
  reportBoundaryError,
}));

// React logs the caught error to console.error even when a boundary handles
// it. That is expected here — silence it so a passing run stays readable.
const consoleError = vi
  .spyOn(console, "error")
  .mockImplementation(() => undefined);

afterAll(() => consoleError.mockRestore());

function Boom(): React.ReactElement {
  throw new Error("map ref was not an Element");
}

describe("ErrorBoundary", () => {
  beforeEach(() => {
    reportBoundaryError.mockClear();
  });

  it("renders children untouched when nothing throws", () => {
    render(
      <ErrorBoundary errorType="shared-trip-map" fallback={<p>fallback</p>}>
        <p>the itinerary</p>
      </ErrorBoundary>
    );

    expect(screen.getByText("the itinerary")).toBeTruthy();
    expect(screen.queryByText("fallback")).toBeNull();
    expect(reportBoundaryError).not.toHaveBeenCalled();
  });

  // The whole point: Sentry -26/-27 escaped to the ROUTE boundary and replaced
  // a shared trip with a full-screen error. A throw must stop here instead.
  it("swaps in the fallback instead of letting the throw escape", () => {
    render(
      <ErrorBoundary errorType="shared-trip-map" fallback={<p>fallback</p>}>
        <Boom />
      </ErrorBoundary>
    );

    expect(screen.getByText("fallback")).toBeTruthy();
  });

  it("still reports the error, tagged with the errorType", () => {
    render(
      <ErrorBoundary errorType="shared-trip-map" fallback={<p>fallback</p>}>
        <Boom />
      </ErrorBoundary>
    );

    expect(reportBoundaryError).toHaveBeenCalledTimes(1);
    const [error, errorType] = reportBoundaryError.mock.calls[0];
    expect((error as Error).message).toBe("map ref was not an Element");
    expect(errorType).toBe("shared-trip-map");
  });

  it("contains the failure without unmounting siblings", () => {
    render(
      <div>
        <p>sibling still here</p>
        <ErrorBoundary errorType="shared-trip-map" fallback={<p>fallback</p>}>
          <Boom />
        </ErrorBoundary>
      </div>
    );

    expect(screen.getByText("sibling still here")).toBeTruthy();
    expect(screen.getByText("fallback")).toBeTruthy();
  });
});
