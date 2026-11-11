import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enCommon from "@/messages/en/common.json";

// The same object every render: the sheet resets itself when `reset` changes.
const search = vi.hoisted(() => ({
  query: "",
  category: null,
  results: [],
  isSearching: false,
  changeQuery: vi.fn(),
  toggleCategory: vi.fn(),
  reset: vi.fn(),
}));
vi.mock("@/hooks/useActivitySearch", () => ({ useActivitySearch: () => search }));

import { ProposeActivitySheet } from "./ProposeActivitySheet";

afterEach(cleanup);

// A stop proposed to the crew is given its length from the same list as a
// stop added or edited by hand, written as the card writes it.
describe("ProposeActivitySheet's own stop", () => {
  it("offers the lengths the trip page offers, an hour and a half to start, and proposes the one picked", async () => {
    const onPropose = vi.fn(async () => {});
    render(
      <NextIntlClientProvider locale="en" messages={{ common: enCommon }}>
        <ProposeActivitySheet isOpen onClose={() => {}} tripId="t1" destination="Kyoto, Japan" targetDay={2} onPropose={onPropose} />
      </NextIntlClientProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: `+ ${enCommon.proposeActivity.createCustom}` }));
    fireEvent.change(screen.getByLabelText(`${enCommon.proposeActivity.form.nameLabel} *`), { target: { value: "Matcha at Ippodo" } });

    const length = screen.getByLabelText(enCommon.proposeActivity.form.durationLabel) as HTMLSelectElement;
    expect([...length.options].map((o) => o.text)).toEqual([
      "5 min", "10 min", "15 min", "30 min", "45 min", "1 h", "1 h 30 min", "2 h", "2 h 30 min", "3 h", "4 h", "5 h", "6 h", "8 h",
    ]);
    expect(length.selectedOptions[0].text).toBe("1 h 30 min");

    fireEvent.change(length, { target: { value: "45" } });
    fireEvent.click(screen.getByRole("button", { name: enCommon.proposeActivity.continue }));
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`${enCommon.proposeActivity.submitProposal}$`) }));
    await waitFor(() => expect(onPropose).toHaveBeenCalled());
    expect(onPropose).toHaveBeenCalledWith(expect.objectContaining({ activityData: expect.objectContaining({ name: "Matcha at Ippodo", duration_minutes: 45 }) }));
  });
});
