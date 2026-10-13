/** @vitest-environment jsdom */
/**
 * On a group trip the first-day prompt asks who is planning it, one named
 * co-planner invite each, and keeps the single view-only link one tap below.
 * Solo and unanswered trips keep the prompt they had.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enCommon from "@/messages/en/common.json";

vi.mock("@/lib/analytics", () => ({ trackSharePromptShown: vi.fn(), trackSharePromptAction: vi.fn() }));
vi.mock("@/lib/posthog/events", () => ({
  captureSharePromptShown: vi.fn(),
  captureSharePromptAction: vi.fn(),
  captureShareLinkCopied: vi.fn(),
  captureCoPlannerInviteSent: vi.fn(async () => {}),
}));

import ShareAfterSaveModal from "./ShareAfterSaveModal";

function renderPrompt(tripIntent: "group" | "solo" | "unspecified") {
  render(
    <NextIntlClientProvider locale="en" messages={{ common: enCommon }}>
      <ShareAfterSaveModal
        isOpen
        onClose={vi.fn()}
        onInvite={vi.fn()}
        tripId="trip-1"
        tripTitle="Lisbon Trip"
        tripDays={4}
        destination="Lisbon"
        tripIntent={tripIntent}
      />
    </NextIntlClientProvider>
  );
}

describe("first-day share prompt", () => {
  it("asks a group who is planning, with the view-only link as the second option", () => {
    renderPrompt("group");
    expect(screen.getByTestId("coplanner-invites")).toBeTruthy();
    expect(screen.getByText("Who's planning this with you?")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Or send one view-only link to the group" })).toBeTruthy();
    expect(screen.queryByText(enCommon.share.intent.group.cta)).toBeNull();
  });

  it("keeps the earlier prompt for a solo trip", () => {
    renderPrompt("solo");
    expect(screen.queryByTestId("coplanner-invites")).toBeNull();
    expect(screen.getByText(enCommon.share.intent.solo.cta)).toBeTruthy();
  });

  it("keeps the earlier prompt when nobody said who the trip is for", () => {
    renderPrompt("unspecified");
    expect(screen.queryByTestId("coplanner-invites")).toBeNull();
    expect(screen.getByText(enCommon.share.intent.unknown.cta)).toBeTruthy();
  });
});
