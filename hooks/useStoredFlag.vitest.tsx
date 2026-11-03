import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot, type Root } from "react-dom/client";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useStoredFlag } from "./useStoredFlag";

const KEY = "test-flag";

function Probe({ id = "probe" }: { id?: string }) {
  const [value, set] = useStoredFlag(KEY);
  return (
    <button data-testid={id} onClick={set}>
      {String(value)}
    </button>
  );
}

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = container = undefined;
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("useStoredFlag", () => {
  it("is false until set", () => {
    render(<Probe />);
    expect(screen.getByTestId("probe").textContent).toBe("false");
  });

  it("reads a flag set on an earlier visit", () => {
    localStorage.setItem(KEY, "true");
    render(<Probe />);
    expect(screen.getByTestId("probe").textContent).toBe("true");
  });

  it("stores the flag and updates every component reading it", () => {
    render(
      <>
        <Probe id="a" />
        <Probe id="b" />
      </>
    );
    fireEvent.click(screen.getByTestId("a"));
    expect(screen.getByTestId("a").textContent).toBe("true");
    expect(screen.getByTestId("b").textContent).toBe("true");
    expect(localStorage.getItem(KEY)).toBe("true");
  });

  it("reads and stores the value it was given for a set flag", () => {
    function OneProbe() {
      const [value, set] = useStoredFlag(KEY, "1");
      return (
        <button data-testid="one" onClick={set}>
          {String(value)}
        </button>
      );
    }
    localStorage.setItem(KEY, "true");
    render(<OneProbe />);
    expect(screen.getByTestId("one").textContent).toBe("false");
    fireEvent.click(screen.getByTestId("one"));
    expect(localStorage.getItem(KEY)).toBe("1");
    expect(screen.getByTestId("one").textContent).toBe("true");
  });

  it("still holds where storage is blocked", () => {
    const blocked = () => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    };
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(blocked);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(blocked);
    render(<Probe />);
    fireEvent.click(screen.getByTestId("probe"));
    expect(screen.getByTestId("probe").textContent).toBe("true");
  });

  it("is null in the server HTML, whatever was stored", () => {
    localStorage.setItem(KEY, "true");
    expect(renderToString(<Probe />)).toContain("null");
  });

  it("hydrates the server HTML without a mismatch, then reads the stored flag", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    container.innerHTML = renderToString(<Probe />);
    document.body.appendChild(container);
    // Stored after the server render, as a real server has no storage to read.
    localStorage.setItem(KEY, "true");
    const errors: unknown[] = [];

    await act(async () => {
      root = hydrateRoot(container!, <Probe />, { onRecoverableError: (e) => errors.push(e) });
    });

    expect(errors).toEqual([]);
    expect(container.textContent).toBe("true");
  });
});
