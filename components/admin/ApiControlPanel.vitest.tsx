import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import ApiControlPanel from "./ApiControlPanel";

/**
 * Stopping every API takes one button and stops plans and photos for everyone, so it
 * asks first. There's no button to start them all: some paid APIs are off on purpose.
 */

const calls: Array<{ method: string; body?: Record<string, unknown> }> = [];
let confirmed = true;

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

beforeEach(() => {
  calls.length = 0;
  confirmed = true;
  vi.stubGlobal("confirm", vi.fn(() => confirmed));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (method === "GET") {
        return json({
          configs: [
            {
              id: "1",
              api_name: "gemini",
              display_name: "Gemini",
              description: null,
              enabled: true,
              block_mode: "none",
              category: "ai",
              cost_per_request: 0.003,
            },
          ],
        });
      }
      return json({ success: true, message: "All APIs disabled" });
    })
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const posts = () => calls.filter((c) => c.method === "POST");

describe("the API Control tab", () => {
  it("offers no button to start every API", async () => {
    render(<ApiControlPanel />);
    await screen.findByRole("button", { name: "Disable All" });
    expect(screen.queryByRole("button", { name: "Enable All" })).toBeNull();
  });

  it("stops every API once you've confirmed", async () => {
    render(<ApiControlPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Disable All" }));
    await waitFor(() => expect(posts()).toEqual([{ method: "POST", body: { action: "disable_all" } }]));
  });

  it("does nothing if you change your mind", async () => {
    confirmed = false;
    render(<ApiControlPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Disable All" }));
    expect(window.confirm).toHaveBeenCalled();
    expect(posts()).toEqual([]);
  });
});
