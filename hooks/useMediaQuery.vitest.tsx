import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { useIsPhone, useMediaQuery } from "./useMediaQuery";

/** A matchMedia whose answer the test can flip, firing "change" like a browser. */
function fakeMatchMedia(initial: boolean) {
  let matches = initial;
  const listeners = new Set<() => void>();
  const queries: string[] = [];
  vi.stubGlobal("matchMedia", (query: string) => {
    queries.push(query);
    return {
      get matches() {
        return matches;
      },
      media: query,
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    };
  });
  return {
    queries,
    listeners,
    set(next: boolean) {
      matches = next;
      listeners.forEach((fn) => fn());
    },
  };
}

function Probe({ query }: { query: string }) {
  return <span data-testid="probe">{useMediaQuery(query) ? "match" : "no match"}</span>;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useMediaQuery", () => {
  it("is false in the server HTML", () => {
    fakeMatchMedia(true);
    expect(renderToString(<Probe query="(max-width: 639px)" />)).toContain("no match");
  });

  it("reads the query on the first client render and follows its changes", () => {
    const media = fakeMatchMedia(true);
    render(<Probe query="(max-width: 639px)" />);
    expect(screen.getByTestId("probe").textContent).toBe("match");

    act(() => media.set(false));
    expect(screen.getByTestId("probe").textContent).toBe("no match");
  });

  it("stops listening on unmount", () => {
    const media = fakeMatchMedia(false);
    const { unmount } = render(<Probe query="(min-width: 1024px)" />);
    expect(media.listeners.size).toBe(1);
    unmount();
    expect(media.listeners.size).toBe(0);
  });

  it("is false where matchMedia is missing or can't be listened to", () => {
    render(<Probe query="(max-width: 639px)" />);
    expect(screen.getByTestId("probe").textContent).toBe("no match");
    cleanup();

    vi.stubGlobal("matchMedia", (query: string) => ({ matches: true, media: query }));
    render(<Probe query="(max-width: 639px)" />);
    expect(screen.getByTestId("probe").textContent).toBe("match");
  });
});

describe("useIsPhone", () => {
  it("asks for widths below Tailwind's sm breakpoint", () => {
    const media = fakeMatchMedia(true);
    function Phone() {
      return <span data-testid="probe">{useIsPhone() ? "phone" : "wider"}</span>;
    }
    render(<Phone />);
    expect(screen.getByTestId("probe").textContent).toBe("phone");
    expect(new Set(media.queries)).toEqual(new Set(["(max-width: 639px)"]));
  });
});
