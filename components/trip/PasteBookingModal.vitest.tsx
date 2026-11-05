/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import itCommon from "@/messages/it/common.json";
import PasteBookingModal from "./PasteBookingModal";

/** A pasted booking the server can't read says why, in the traveller's language. */

const words = itCommon.addFromEmail;
vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ addToast: vi.fn() }) }));

function answers(body: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })));
}

async function pasted() {
  render(
    <NextIntlClientProvider locale="it" messages={{ common: itCommon }}>
      <PasteBookingModal tripId="t1" isOpen onClose={vi.fn()} onBookingAdded={vi.fn()} />
    </NextIntlClientProvider>
  );
  fireEvent.change(screen.getByPlaceholderText(words.placeholder), {
    target: { value: "Your hotel booking at Hotel Roma is confirmed for 10 May 2027. ".repeat(4) },
  });
  fireEvent.click(screen.getByRole("button", { name: words.parseAction }));
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_EMAIL_PARSE_ENABLED", "true");
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("a pasted booking the server can't read", () => {
  it.each([
    ["the model out of service", "model_outage", itCommon.ai.assistant.errors.modelOutage],
    ["no booking in it", "no_booking_found", words.errorNoBooking],
    ["a model that failed", "parse_failed", words.errorParseFailed],
  ])("%s", async (_name, error, expected) => {
    answers({ error });
    await pasted();
    expect(await screen.findByText(expected)).toBeTruthy();
  });
});
