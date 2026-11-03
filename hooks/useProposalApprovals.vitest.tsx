import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { cleanup, renderHook } from "@testing-library/react";
import type { Activity, ActivityProposal } from "@/types";

const addToast = vi.fn();
const refresh = vi.fn();
vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ addToast }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => `${key} ${JSON.stringify(values)}`,
}));

import { useProposalApprovals } from "./useProposalApprovals";

/**
 * The trip page's side of a proposal the crew approved: once per proposal,
 * a toast names the activity, the stored trip is read again (or the page
 * refreshed when that fails), and the proposal stays in recentlyApproved for
 * 3 s while its approval animates.
 */

const proposal = (id: string, status: string, name?: string) =>
  ({ id, status, target_day: 2, activity_data: name ? ({ name } as Activity) : undefined }) as unknown as ActivityProposal;

function setup(refetchQueued = vi.fn(async () => undefined)) {
  const view = renderHook(() => useProposalApprovals(refetchQueued));
  const report = async (p: ActivityProposal) => {
    await act(async () => view.result.current.handleProposalChange(p));
  };
  const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms));
  const shown = () => [...view.result.current.recentlyApproved].sort();
  return { refetchQueued, report, wait, shown };
}

beforeEach(() => {
  vi.useFakeTimers();
  addToast.mockClear();
  refresh.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useProposalApprovals", () => {
  it("names the approved activity, reads the stored trip again, and shows the approval for 3 s", async () => {
    const { refetchQueued, report, wait, shown } = setup();
    await report(proposal("p1", "approved", "Tram 28"));
    expect(addToast).toHaveBeenCalledWith('detail.proposalApproved {"name":"Tram 28","day":2}', "success");
    expect(refetchQueued).toHaveBeenCalledTimes(1);
    expect(shown()).toEqual(["p1"]);
    await wait(2999);
    expect(shown()).toEqual(["p1"]);
    await wait(1);
    expect(shown()).toEqual([]);
  });

  it("counts an approval reported twice once, as when the owner's approve is followed by realtime", async () => {
    const { refetchQueued, report } = setup();
    await report(proposal("p1", "approved", "Tram 28"));
    await report(proposal("p1", "approved", "Tram 28"));
    expect(addToast).toHaveBeenCalledTimes(1);
    expect(refetchQueued).toHaveBeenCalledTimes(1);
  });

  it("does nothing for a proposal still open or turned down", async () => {
    const { refetchQueued, report, shown } = setup();
    for (const status of ["pending", "voting", "rejected", "withdrawn", "expired"]) {
      await report(proposal(`p-${status}`, status, "Ferry"));
    }
    expect(addToast).not.toHaveBeenCalled();
    expect(refetchQueued).not.toHaveBeenCalled();
    expect(shown()).toEqual([]);
  });

  it("still reads the stored trip and shows the approval when the activity has no name", async () => {
    const { refetchQueued, report, shown } = setup();
    await report(proposal("p1", "approved"));
    expect(addToast).not.toHaveBeenCalled();
    expect(refetchQueued).toHaveBeenCalledTimes(1);
    expect(shown()).toEqual(["p1"]);
  });

  it("refreshes the page when the stored trip cannot be read", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { report } = setup(vi.fn(async () => Promise.reject(new Error("offline"))));
    await report(proposal("p1", "approved", "Tram 28"));
    expect(refresh).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("ends each approval's 3 s on its own", async () => {
    const { report, wait, shown } = setup();
    await report(proposal("p1", "approved", "Tram 28"));
    await wait(1000);
    await report(proposal("p2", "approved", "Fado night"));
    expect(shown()).toEqual(["p1", "p2"]);
    await wait(2000);
    expect(shown()).toEqual(["p2"]);
    await wait(1000);
    expect(shown()).toEqual([]);
    expect(refresh).not.toHaveBeenCalled();
  });
});
