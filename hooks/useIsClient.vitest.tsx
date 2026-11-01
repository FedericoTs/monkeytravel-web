import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot, type Root } from "react-dom/client";
import { cleanup, render, screen } from "@testing-library/react";
import { useIsClient } from "./useIsClient";

function Probe() {
  return <span data-testid="probe">{useIsClient() ? "client" : "server"}</span>;
}

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = container = undefined;
  cleanup();
});

describe("useIsClient", () => {
  it("is false in the server HTML", () => {
    expect(renderToString(<Probe />)).toContain("server");
  });

  it("is true straight away on a client render", () => {
    render(<Probe />);
    expect(screen.getByTestId("probe").textContent).toBe("client");
  });

  it("hydrates the server HTML without a mismatch, then turns true", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    container.innerHTML = renderToString(<Probe />);
    document.body.appendChild(container);
    const errors: unknown[] = [];

    await act(async () => {
      root = hydrateRoot(container!, <Probe />, { onRecoverableError: (e) => errors.push(e) });
    });

    expect(errors).toEqual([]);
    expect(container.textContent).toBe("client");
  });
});
