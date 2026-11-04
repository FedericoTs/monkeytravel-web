/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import itTrips from "@/messages/it/trips.json";
import type { TripAnchor } from "@/types";
import AnchorEditor from "./AnchorEditor";

/**
 * A pasted plan the server won't read says why in the traveller's language. The
 * server's own text is English.
 */

const words = itTrips.wizard.anchors.import;
const anchor = { id: "a1", date: "2027-05-10", type: "event", title: "Wedding", slot: "all_day" } as TripAnchor;

function answers(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: status < 400, status, json: async () => body }))
  );
}

/** Pastes a plan and returns what the editor says about it. */
async function pasted() {
  render(
    <NextIntlClientProvider locale="it" messages={{ trips: itTrips }}>
      <AnchorEditor anchors={[anchor]} onChange={vi.fn()} startDate="2027-05-10" endDate="2027-05-12" destination="Paris" />
    </NextIntlClientProvider>
  );
  fireEvent.click(screen.getByRole("button", { name: new RegExp(words.cta) }));
  fireEvent.change(screen.getByRole("textbox", { name: words.label }), {
    target: { value: "Day 1: land in Venice at 09:40, then a night in Trieste" },
  });
  fireEvent.click(screen.getByRole("button", { name: words.submit }));
  return (await screen.findByRole("alert")).textContent;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("a pasted plan the server won't read", () => {
  it.each([
    ["too little text", 400, { error: "Paste a bit more", reason: "too_short" }, words.tooShort],
    ["no dated plans in it", 400, { error: "We couldn't find any", reason: "nothing_found" }, words.nothingFound],
    ["today's free imports used", 429, { error: "You've used your free plan imports", code: "RATE_LIMIT" }, words.limit],
    ["the model failing", 503, { error: "Couldn't read that plan right now" }, words.error],
    ["anything else refused", 400, { error: "startDate and endDate must be valid ISO dates" }, words.error],
  ])("%s", async (_name, status, body, expected) => {
    answers(status, body);
    expect(await pasted()).toBe(expected);
  });

  it("a dropped connection", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Load failed"))));
    expect(await pasted()).toBe(words.error);
  });
});
