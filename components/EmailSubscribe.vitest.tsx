/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import EmailSubscribe from "./EmailSubscribe";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));

const submit = () => {
  render(<EmailSubscribe />);
  fireEvent.change(screen.getByPlaceholderText("placeholder"), { target: { value: "planner@example.com" } });
  fireEvent.submit(screen.getByPlaceholderText("placeholder").closest("form") as HTMLFormElement);
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("EmailSubscribe", () => {
  it("says it in the page's language when the connection drops, not the browser's words", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("Load failed");
    }));
    submit();
    expect(await screen.findByText("errorMessage")).toBeTruthy();
    expect(screen.queryByText("Load failed")).toBeNull();
  });

  it("still shows what the server answered", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "That address is already on the list" }), { status: 400 })));
    submit();
    expect(await screen.findByText("That address is already on the list")).toBeTruthy();
  });
});
