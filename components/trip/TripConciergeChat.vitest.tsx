/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import itCommon from "@/messages/it/common.json";
import TripConciergeChat from "./TripConciergeChat";

/**
 * The concierge's answer arrives as server-sent events and appears as it comes.
 * What the traveller reads when it fails is in their language.
 */

const words = itCommon.concierge;
const addToast = vi.fn();
vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ addToast }) }));
vi.mock("@/lib/posthog/events", () => {
  const event = () => Promise.resolve();
  return {
    captureConciergeOpened: event,
    captureConciergeQuestionSent: event,
    captureConciergeResponseReceived: event,
    captureConciergeQuotaBlocked: event,
    captureConciergeError: event,
    captureConciergeProposalShown: event,
    captureConciergeProposalApplied: event,
  };
});

function answersWith(events: unknown[]) {
  const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
  vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { headers: { "Content-Type": "text/event-stream" } })));
}

async function ask() {
  render(
    <NextIntlClientProvider locale="it" messages={{ common: itCommon }}>
      <TripConciergeChat tripId="trip-1" />
    </NextIntlClientProvider>
  );
  fireEvent.click(screen.getByRole("button", { name: words.triggerLabel }));
  fireEvent.change(screen.getByLabelText(words.inputLabel), { target: { value: "Dove ceniamo?" } });
  fireEvent.click(screen.getByRole("button", { name: words.send }));
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_CONCIERGE_ENABLED", "true");
  addToast.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("the concierge's answer", () => {
  it("is put together from the stream's chunks", async () => {
    answersWith([
      { type: "chunk", text: "Prova " },
      { type: "chunk", text: "Mlejnice." },
      { type: "done", isLiveTrip: false, dayNumber: null },
    ]);
    await ask();
    expect(await screen.findByText("Prova Mlejnice.")).toBeTruthy();
  });

  it("failing mid-stream says so in the traveller's language", async () => {
    answersWith([{ type: "chunk", text: "Prova " }, { type: "error", message: "Couldn't answer right now." }]);
    await ask();
    expect(await screen.findByText(words.errorGeneric)).toBeTruthy();
  });

  it("says the AI is down, instead of asking for another try, when the model is out of service", async () => {
    answersWith([{ type: "error", code: "MODEL_OUTAGE" }]);
    await ask();
    expect(await screen.findByText(itCommon.ai.assistant.errors.modelOutage)).toBeTruthy();
    expect(screen.queryByText(words.errorGeneric)).toBeNull();
  });

  it("says when the day's limit is reached", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ code: "USAGE_LIMIT_REACHED" }), { status: 403 }))
    );
    await ask();
    expect(await screen.findByText(words.errorQuota)).toBeTruthy();
  });

  it("with no stream to read reports a failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null)));
    await ask();
    await waitFor(() => expect(addToast).toHaveBeenCalledWith(words.errorGeneric, "error"));
  });
});
