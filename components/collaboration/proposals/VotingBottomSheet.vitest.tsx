import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import common from "@/messages/en/common.json";
import type { ProposalWithVotes } from "@/types";
import { VotingBottomSheet } from "./VotingBottomSheet";

const PROPOSAL = {
  id: "p1",
  trip_id: "t1",
  proposed_by: "mate-1",
  type: "new",
  activity_data: { name: "Rooftop bar", type: "bar", start_time: "21:00", duration_minutes: 90 },
  target_day: 1,
  status: "voting",
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
  votes: [],
  vote_summary: { love: 0, flexible: 0, concerns: 0, no: 0, total: 0 },
} as unknown as ProposalWithVotes;

function sheet(proposal: ProposalWithVotes | null, onClose = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={{ common }}>
      <VotingBottomSheet isOpen onClose={onClose} proposal={proposal} onVote={async () => {}} />
    </NextIntlClientProvider>
  );
  return onClose;
}

afterEach(cleanup);

describe("VotingBottomSheet as a dialog", () => {
  it("is named by the proposed activity, takes focus and closes on Escape", async () => {
    const onClose = sheet(PROPOSAL);
    const dialog = screen.getByRole("dialog", { name: "Rooftop bar" });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("is still a named dialog when there is no proposal to show", () => {
    sheet(null);
    expect(screen.getByRole("dialog", { name: common.voting.noProposalSelected })).toBeTruthy();
  });
});
