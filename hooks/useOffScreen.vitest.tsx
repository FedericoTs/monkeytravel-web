import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { useOffScreen } from "./useOffScreen";

type Report = (entries: Array<{ isIntersecting: boolean }>) => void;
let observers: Array<{ report: Report; watched: Element[]; stopped: boolean }>;

beforeEach(() => {
  observers = [];
  class FakeObserver {
    private own: (typeof observers)[number];
    constructor(report: Report) {
      this.own = { report, watched: [], stopped: false };
      observers.push(this.own);
    }
    observe(el: Element) {
      this.own.watched.push(el);
    }
    disconnect() {
      this.own.stopped = true;
    }
  }
  vi.stubGlobal("IntersectionObserver", FakeObserver);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Probe({ shown = true }: { shown?: boolean }) {
  const { ref, offScreen } = useOffScreen<HTMLButtonElement>();
  return (
    <div>
      {shown && <button ref={ref}>entry</button>}
      <output>{offScreen ? "away" : "here"}</output>
    </div>
  );
}

const state = () => screen.getByRole("status").textContent;
const report = (isIntersecting: boolean, at = observers.length - 1) => act(() => observers[at].report([{ isIntersecting }]));

describe("useOffScreen", () => {
  it("says an element is away only once the browser reports it out of view", () => {
    render(<Probe />);
    expect(observers).toHaveLength(1);
    expect(observers[0].watched).toEqual([screen.getByText("entry")]);
    expect(state()).toBe("here");
    report(false);
    expect(state()).toBe("away");
    report(true);
    expect(state()).toBe("here");
  });

  it("goes by the last of several reports", () => {
    render(<Probe />);
    act(() => observers[0].report([{ isIntersecting: true }, { isIntersecting: false }]));
    expect(state()).toBe("away");
    act(() => observers[0].report([{ isIntersecting: false }, { isIntersecting: true }]));
    expect(state()).toBe("here");
  });

  it("is not away when the element is gone, and starts over when it comes back", () => {
    const { rerender } = render(<Probe />);
    report(false);
    expect(state()).toBe("away");
    rerender(<Probe shown={false} />);
    expect(state()).toBe("here");
    expect(observers[0].stopped).toBe(true);
    rerender(<Probe />);
    expect(observers).toHaveLength(2);
    expect(state()).toBe("here");
    report(false);
    expect(state()).toBe("away");
  });

  it("has nothing away when there is nothing to watch", () => {
    render(<Probe shown={false} />);
    expect(observers).toHaveLength(0);
    expect(state()).toBe("here");
  });

  it("stops watching when the page lets go of it", () => {
    const { unmount } = render(<Probe />);
    unmount();
    expect(observers[0].stopped).toBe(true);
  });

  it("stays in view in a browser that cannot report it", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    render(<Probe />);
    expect(observers).toHaveLength(0);
    expect(state()).toBe("here");
  });
});
