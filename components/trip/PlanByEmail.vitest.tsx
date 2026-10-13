/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enCommon from "@/messages/en/common.json";
import type { ParticipantsResponse } from "@/lib/participants/shared";
import { publishParticipants, subscribeParticipants } from "@/lib/participants/live-store";
import PlanByEmail from "./PlanByEmail";

/**
 * Under the plan on a share link: one tap says they're going and emails them
 * the plan, and the page says what happened to that email. It shows the same
 * person the "I'm going" bar does.
 */

const copy = enCommon.share.planByEmail;
let token = 0;

const me = (joined: boolean, hasEmail: boolean): ParticipantsResponse => ({
  count: joined ? 1 : 0,
  participants: [],
  me: { joined, display_name: null, has_email: hasEmail },
});

/** Answers POST /join with `answer`; returns the bodies it was sent. */
function serve(answer: () => Response) {
  const bodies: Record<string, unknown>[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return answer();
    }),
  );
  return bodies;
}
const joinedWith = (planEmail: string) => () =>
  new Response(JSON.stringify({ ...me(true, true), plan_email: planEmail }));

function renderAsk(props: { defaultEmail?: string } = {}) {
  const shareToken = `token-${++token}`;
  render(
    <NextIntlClientProvider locale="en" messages={{ common: enCommon }}>
      <PlanByEmail shareToken={shareToken} source="crew_ask" {...props} />
    </NextIntlClientProvider>,
  );
  return shareToken;
}

const submit = (address: string, button: string = copy.submit) => {
  fireEvent.change(screen.getByLabelText(copy.emailLabel), { target: { value: address } });
  fireEvent.click(screen.getByRole("button", { name: button }));
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PlanByEmail", () => {
  it("says they're going and emails the plan in one tap, then says it's on its way", async () => {
    const bodies = serve(joinedWith("sent"));
    const shareToken = renderAsk();
    const seen: ParticipantsResponse[] = [];
    const stop = subscribeParticipants(shareToken, (snapshot) => seen.push(snapshot));
    expect(screen.getByText(copy.title)).toBeTruthy();
    submit(" Ana@Example.com ");
    expect(await screen.findByText("The plan is on its way to ana@example.com.")).toBeTruthy();
    expect(screen.getByText(enCommon.share.participants.youreIn)).toBeTruthy();
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(`/api/shared/${shareToken}/join`);
    expect(bodies).toEqual([{ action: "join", source: "crew_ask", locale: "en", email: "ana@example.com" }]);
    // The bar at the top hears it too.
    expect(seen.at(-1)?.me.joined).toBe(true);
    stop();
  });

  it("checks the address before sending it", () => {
    serve(joinedWith("sent"));
    renderAsk();
    submit("ana@");
    expect(screen.getByRole("alert").textContent).toBe(copy.invalidEmail);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("says when the plan went before, when it could not go, and when nothing worked", async () => {
    serve(joinedWith("already"));
    renderAsk();
    submit("ana@example.com");
    expect(await screen.findByText("We already sent the plan to ana@example.com.")).toBeTruthy();
    cleanup();

    serve(joinedWith("not_sent"));
    renderAsk();
    submit("ana@example.com");
    expect(await screen.findByText(copy.notSent)).toBeTruthy();
    cleanup();

    serve(() => new Response("{}", { status: 500 }));
    renderAsk();
    submit("ana@example.com");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(enCommon.share.participants.error));
    expect(screen.getByText(copy.title)).toBeTruthy();
  });

  it("follows the bar: asks someone going for an address, and lets someone already emailed ask again", () => {
    const bodies = serve(joinedWith("sent"));
    const shareToken = renderAsk();
    act(() => publishParticipants(shareToken, me(true, false)));
    expect(screen.getByText(copy.titleJoined)).toBeTruthy();

    act(() => publishParticipants(shareToken, me(true, true)));
    expect(screen.queryByLabelText(copy.emailLabel)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: copy.submitJoined }));
    expect(screen.getByText(copy.titleJoined)).toBeTruthy();

    // Not going any more: the ask is back.
    act(() => publishParticipants(shareToken, me(false, true)));
    expect(screen.getByText(copy.title)).toBeTruthy();
    expect(bodies).toEqual([]);
  });

  it("fills in a signed-in viewer's address for them to confirm", () => {
    renderAsk({ defaultEmail: "me@example.com" });
    expect((screen.getByLabelText(copy.emailLabel) as HTMLInputElement).value).toBe("me@example.com");
  });
});
