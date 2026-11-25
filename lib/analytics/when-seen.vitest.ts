// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { whenSeen } from "./when-seen";

let visibility: DocumentVisibilityState = "visible";
Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
const show = (state: DocumentVisibilityState) => {
  visibility = state;
  document.dispatchEvent(new Event("visibilitychange"));
};

afterEach(() => {
  visibility = "visible";
});

describe("whenSeen", () => {
  it("records at once on a visible page", () => {
    const record = vi.fn();
    expect(whenSeen(record)).toBeUndefined();
    expect(record).toHaveBeenCalledTimes(1);
  });

  it("waits for a page loaded in the background to be seen, then records once", () => {
    visibility = "hidden";
    const record = vi.fn();
    whenSeen(record);
    expect(record).not.toHaveBeenCalled();
    show("hidden");
    expect(record).not.toHaveBeenCalled();
    show("visible");
    show("hidden");
    show("visible");
    expect(record).toHaveBeenCalledTimes(1);
  });

  it("records nothing for a page never seen once cancelled", () => {
    visibility = "hidden";
    const record = vi.fn();
    const cancel = whenSeen(record);
    cancel?.();
    show("visible");
    expect(record).not.toHaveBeenCalled();
  });
});
