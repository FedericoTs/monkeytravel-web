import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import AccessControl from "./AccessControl";

/**
 * Save writes the whole allowed list. So the form has to load it, from the admin-only
 * route, and must not offer to save when it couldn't: an empty box would wipe the list.
 */

const CONFIG = {
  id: 1,
  maintenance_mode: false,
  maintenance_title: "Down",
  maintenance_message: "Back soon",
  maintenance_started_at: null,
  allowed_emails: ["one@mail.example.com", "two@mail.example.com"],
};

const calls: Array<{ url: string; method: string; body?: Record<string, unknown> }> = [];
let loadOk = true;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  calls.length = 0;
  loadOk = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (method === "GET") return loadOk ? json(CONFIG) : json({ error: "Failed" }, 500);
      return json({ success: true, config: CONFIG });
    })
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const box = () => document.getElementById("maintenance-bypass-emails") as HTMLTextAreaElement;
const saveButton = () => screen.getByRole("button", { name: /save configuration/i }) as HTMLButtonElement;

describe("the Access tab", () => {
  it("loads the allowed list from the admin-only route", async () => {
    render(<AccessControl />);
    await waitFor(() => expect(box().value).toBe("one@mail.example.com\ntwo@mail.example.com"));
    expect(calls[0]).toMatchObject({ url: "/api/admin/config/access", method: "GET" });
  });

  it("saves the list it loaded, not an empty one", async () => {
    render(<AccessControl />);
    await waitFor(() => expect(box().value).not.toBe(""));
    fireEvent.click(saveButton());
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(calls.find((c) => c.method === "PATCH")?.body?.allowed_emails).toEqual(CONFIG.allowed_emails);
  });

  it("won't save when the config couldn't be loaded", async () => {
    loadOk = false;
    render(<AccessControl />);
    await screen.findByText(/failed to fetch config/i);
    expect(saveButton().disabled).toBe(true);
    fireEvent.click(saveButton());
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
  });
});
