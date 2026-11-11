import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * A signed-out browser starts a new PostHog visitor instead of carrying on as
 * the person who signed out there.
 */

type Ready = (posthog: { get_property: (name: string) => unknown; reset: () => void }) => void;
const { ready } = vi.hoisted(() => ({ ready: vi.fn<(fn: Ready) => void>() }));
vi.mock("./client", () => ({ onPostHogReady: (fn: Ready) => ready(fn) }));

import { forgetSignedOutPerson } from "./identify";

const posthogKnownAs = (state: string | undefined) => ({
  get_property: vi.fn((name: string) => (name === "$user_state" ? state : undefined)),
  reset: vi.fn(),
});

beforeEach(() => ready.mockReset());

describe("forgetSignedOutPerson", () => {
  it("starts a new visitor when PostHog still knows a signed-in person", () => {
    forgetSignedOutPerson();
    const posthog = posthogKnownAs("identified");
    ready.mock.calls[0][0](posthog);
    expect(posthog.reset).toHaveBeenCalledOnce();
  });

  it.each(["anonymous", undefined])("leaves a visitor who never signed in alone (%s)", (state) => {
    forgetSignedOutPerson();
    const posthog = posthogKnownAs(state);
    ready.mock.calls[0][0](posthog);
    expect(posthog.reset).not.toHaveBeenCalled();
  });
});
