/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ParticipantsResponse } from "@/lib/participants/shared";
import { publishParticipants } from "@/lib/participants/live-store";
import ParticipantsBar from "./ParticipantsBar";

/**
 * "I'm going" flips the bar at once, and the count is the one the server
 * returns. Someone who said they're going on the public page is in the count
 * already, so joining here must not show them twice.
 */

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key, useLocale: () => "en" }));

const group = (count: number, joined: boolean): ParticipantsResponse => ({
  count,
  participants: [],
  me: { joined, display_name: "Pat", has_email: false },
});
const countShown = () => screen.getByTestId("participants-count").getAttribute("data-count");

/** Serves `before` to the page, and answers the join with `after` once `confirm` is called. */
function serve(before: ParticipantsResponse, after: ParticipantsResponse) {
  let confirm = () => {};
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: string, init?: RequestInit) =>
      init?.method === "POST"
        ? new Promise<Response>((resolve) => {
            confirm = () => resolve(new Response(JSON.stringify(after)));
          })
        : Promise.resolve(new Response(JSON.stringify(before))),
    ),
  );
  return { confirm: () => confirm() };
}

async function tapImGoing(before: ParticipantsResponse, after: ParticipantsResponse) {
  const server = serve(before, after);
  render(<ParticipantsBar shareToken="token-1" source="shared" crewAsk={false} tripTitle="Lisbon" onSaveForLater={() => {}} />);
  await waitFor(() => expect(countShown()).toBe(String(before.count)));
  fireEvent.click(screen.getByTestId("participants-join"));
  expect(screen.getByTestId("participants-joined")).toBeTruthy();
  return server;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ParticipantsBar", () => {
  it("doesn't count someone twice who joins after saying they're going on the public page", async () => {
    const server = await tapImGoing(group(2, false), group(2, true));
    expect(countShown()).toBe("2");
    await act(async () => server.confirm());
    await screen.findByTestId("participants-name");
    expect(countShown()).toBe("2");
  });

  it("counts a new joiner once the server confirms", async () => {
    const server = await tapImGoing(group(1, false), group(2, true));
    await act(async () => server.confirm());
    await screen.findByTestId("participants-name");
    expect(countShown()).toBe("2");
  });

  it("says the plan is on its way once an email is saved, and asks in the page's language", async () => {
    const posts: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method !== "POST") return new Response(JSON.stringify(group(1, false)));
        const body = JSON.parse(String(init.body));
        posts.push(body);
        const going = group(2, true);
        return new Response(
          JSON.stringify(body.email ? { ...going, me: { ...going.me, has_email: true }, plan_email: "sent" } : going),
        );
      }),
    );
    render(<ParticipantsBar shareToken="token-email" source="shared" crewAsk={false} tripTitle="Lisbon" onSaveForLater={() => {}} />);
    await waitFor(() => expect(countShown()).toBe("1"));
    fireEvent.click(screen.getByTestId("participants-join"));
    fireEvent.change(await screen.findByTestId("participants-name"), { target: { value: "" } });
    fireEvent.click(screen.getByText("share.participants.skip"));
    fireEvent.change(await screen.findByPlaceholderText("share.participants.emailPlaceholder"), { target: { value: "pat@example.com" } });
    fireEvent.click(screen.getByText("share.participants.save"));
    expect((await screen.findByTestId("participants-done")).textContent).toContain("share.planByEmail.sent");
    expect(posts).toEqual([
      { source: "shared", locale: "en", action: "join" },
      { source: "shared", locale: "en", action: "update", email: "pat@example.com" },
    ]);
  });

  it("shows someone going who said so at the bottom of the page", async () => {
    serve(group(0, false), group(1, true));
    render(<ParticipantsBar shareToken="token-footer" source="shared" crewAsk={false} tripTitle="Lisbon" onSaveForLater={() => {}} />);
    await waitFor(() => expect(countShown()).toBe("0"));
    act(() => publishParticipants("token-footer", group(1, true)));
    expect(screen.getByTestId("participants-joined")).toBeTruthy();
    expect(countShown()).toBe("1");
  });
});
