import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enCommon from "@/messages/en/common.json";
import itCommon from "@/messages/it/common.json";

/**
 * The share prompt's closing button says what it does.
 *
 * With "Share this trip on Explore" ticked (the default for a trip without
 * pinned plans), the button publishes the trip to Explore. It read "Done", so
 * people finishing up published without meaning to. It now reads "Publish to
 * Explore"; unticked it is still "Maybe Later" and publishes nothing.
 */

vi.mock("@/lib/analytics", () => ({ trackSharePromptShown: vi.fn(), trackSharePromptAction: vi.fn() }));
vi.mock("@/lib/posthog/events", () => ({
  captureSharePromptShown: vi.fn(),
  captureSharePromptAction: vi.fn(),
  captureShareLinkCopied: vi.fn(),
}));

import ShareAfterSaveModal from "./ShareAfterSaveModal";

function renderPrompt(locale: string, common: object, onPublish = vi.fn()) {
  render(
    <NextIntlClientProvider locale={locale} messages={{ common }}>
      <ShareAfterSaveModal
        isOpen
        onClose={vi.fn()}
        onInvite={vi.fn()}
        onPublish={onPublish}
        tripId="trip-1"
        tripTitle="Lisbon Trip"
        tripDays={4}
        destination="Lisbon"
      />
    </NextIntlClientProvider>
  );
  return onPublish;
}

describe("share prompt closing button", () => {
  it("with the box ticked it says it publishes, and does", () => {
    const onPublish = renderPrompt("en", enCommon);
    const button = screen.getByRole("button", { name: "Publish to Explore" });
    expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
    fireEvent.click(button);
    expect(onPublish).toHaveBeenCalledTimes(1);
  });

  it("unticked it is 'Maybe Later' and publishes nothing", () => {
    const onPublish = renderPrompt("en", enCommon);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Maybe Later" }));
    expect(onPublish).not.toHaveBeenCalled();
  });

  it("in the page's language", () => {
    renderPrompt("it", itCommon);
    expect(screen.getByRole("button", { name: "Pubblica su Explore" })).toBeTruthy();
  });
});
