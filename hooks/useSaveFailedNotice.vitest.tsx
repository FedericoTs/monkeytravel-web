import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";
import type { ItinerarySaveStatus } from "@/hooks/useItinerarySync";

/**
 * On a phone a failed save showed nothing: the pill with the retry is hidden
 * there, and sits above the plan on any screen. Now a notice says so wherever
 * the traveller is, with a Retry, until a save goes through.
 */

const addToast = vi.fn((..._args: unknown[]) => `toast-${addToast.mock.calls.length}`);
const removeToast = vi.fn();
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ addToast, removeToast }) }));

import { useSaveFailedNotice } from "./useSaveFailedNotice";

function setup(status: ItinerarySaveStatus) {
  const retry = vi.fn();
  const view = renderHook(({ s }: { s: ItinerarySaveStatus }) => useSaveFailedNotice(s, retry), { initialProps: { s: status } });
  return { retry, set: (s: ItinerarySaveStatus) => view.rerender({ s }) };
}
const action = (call: number) => addToast.mock.calls[call][3] as { label: string; onClick: () => void };

afterEach(() => {
  cleanup();
  addToast.mockClear();
  removeToast.mockClear();
});

describe("a failed save", () => {
  it("shows a notice that stays, with a Retry", () => {
    const { set } = setup("saved");
    expect(addToast).not.toHaveBeenCalled();
    set("error");
    expect(addToast).toHaveBeenCalledTimes(1);
    expect(addToast.mock.calls[0].slice(0, 3)).toEqual(["detail.saveFailedNotice", "error", 0]);
    expect(action(0).label).toBe("detail.retrySave");
  });

  it("shows one notice, however often the page renders", () => {
    const { set } = setup("error");
    set("error");
    set("error");
    expect(addToast).toHaveBeenCalledTimes(1);
  });

  it("takes the notice away once a save goes through", () => {
    const { set } = setup("error");
    set("saving");
    expect(removeToast).toHaveBeenCalledWith("toast-1");
    set("saved");
    expect(removeToast).toHaveBeenCalledTimes(1);
  });

  it("saves again on Retry, and a second failure shows a new notice", () => {
    const { retry, set } = setup("error");
    action(0).onClick();
    expect(retry).toHaveBeenCalledTimes(1);
    set("saving");
    set("error");
    expect(addToast).toHaveBeenCalledTimes(2);
  });

  it("says nothing while saves go through", () => {
    const { set } = setup("idle");
    set("saving");
    set("saved");
    set("conflict");
    expect(addToast).not.toHaveBeenCalled();
  });
});
