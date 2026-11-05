/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { SharedTripEndAsk } from "./SharedTripAsks";

/** The fixed bar's height, which the cookie banner sits above, through the real hook. */

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/lib/i18n/routing", () => ({ Link: ({ children }: { children: ReactNode }) => <a>{children}</a> }));
vi.mock("@/components/ShareRow", () => ({ default: () => null }));
vi.mock("@/components/trip/ParticipantsBar", () => ({ default: () => null }));
vi.mock("@/components/trip/PlanByEmail", () => ({ default: () => null }));
vi.mock("@/components/trip/WhoIsGoingCard", () => ({ default: () => null }));

const HEIGHT = "--mt-bottom-bar-h";
const published = () => document.documentElement.style.getPropertyValue(HEIGHT);

const end = (over: Partial<ComponentProps<typeof SharedTripEndAsk>> = {}) => (
  <SharedTripEndAsk
    participantsEnabled
    isOwner={false}
    shareToken="token"
    crewAsk={false}
    planOwnHref="/trips/new"
    onPlanOwn={() => {}}
    onSave={() => {}}
    ownerPending={false}
    tripOver={false}
    destination="Lisbon"
    likeThisDays={null}
    {...over}
  />
);

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    }
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ height: 88 } as DOMRect);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the bar's height", () => {
  it("isn't published without a fixed bar", () => {
    render(end());
    expect(published()).toBe("");
  });

  it("is published for the sharer's strip, which appears once the claim has been read", () => {
    const view = render(end());
    view.rerender(end({ ownerPending: true }));
    expect(published()).toBe("88px");
  });

  it("is taken back when the strip goes", () => {
    const view = render(end({ ownerPending: true }));
    expect(published()).toBe("88px");
    view.rerender(end());
    expect(published()).toBe("");
  });

  it("is published for the two-button bar with participants off", () => {
    render(end({ participantsEnabled: false }));
    expect(published()).toBe("88px");
  });

  it("isn't published for an owner, who has no bar", () => {
    render(end({ isOwner: true }));
    expect(published()).toBe("");
  });
});
