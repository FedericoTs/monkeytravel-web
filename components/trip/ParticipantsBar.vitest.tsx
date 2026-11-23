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

describe("ParticipantsBar's More menu", () => {
  it("isn't there when it has nothing to offer", async () => {
    serve(group(1, false), group(1, false));
    render(<ParticipantsBar shareToken="token-1" source="shared" crewAsk={false} tripTitle="Lisbon" />);
    await waitFor(() => expect(countShown()).toBe("1"));
    expect(screen.getByTestId("participants-join")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /share\.participants\.more/ })).toBeNull();
  });

  it("offers only what the page gives it", async () => {
    serve(group(1, false), group(1, false));
    render(<ParticipantsBar shareToken="token-1" source="shared" crewAsk={false} tripTitle="Lisbon" onFork={() => {}} />);
    await waitFor(() => expect(countShown()).toBe("1"));
    fireEvent.click(screen.getByRole("button", { name: /share\.participants\.more/ }));
    expect(screen.getByRole("menuitem", { name: "share.participants.fork" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "share.participants.saveForLater" })).toBeNull();
  });

  it("offers Save for later when the page gives it", async () => {
    serve(group(1, false), group(1, false));
    const onSaveForLater = vi.fn();
    render(<ParticipantsBar shareToken="token-1" source="shared" crewAsk={false} tripTitle="Lisbon" onSaveForLater={onSaveForLater} />);
    await waitFor(() => expect(countShown()).toBe("1"));
    fireEvent.click(screen.getByRole("button", { name: /share\.participants\.more/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "share.participants.saveForLater" }));
    expect(onSaveForLater).toHaveBeenCalledTimes(1);
  });
});

describe("ParticipantsBar", () => {
  it("says it in the page's language when the connection drops, not the browser's words", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === "POST") throw new TypeError("Load failed");
        return new Response(JSON.stringify(group(1, false)));
      }),
    );
    render(<ParticipantsBar shareToken="token-1" source="shared" crewAsk={false} tripTitle="Lisbon" onSaveForLater={() => {}} />);
    await waitFor(() => expect(countShown()).toBe("1"));
    fireEvent.click(screen.getByTestId("participants-join"));
    expect(await screen.findByText("share.participants.error")).toBeTruthy();
    expect(screen.queryByText("Load failed")).toBeNull();
  });

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

describe("the must-dos someone going adds", () => {
  /** Answers every read with `before` and every write with `after`, and keeps what was written. */
  function record(before: ParticipantsResponse, after: ParticipantsResponse) {
    const posts: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method !== "POST") return new Response(JSON.stringify(before));
        posts.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify(after));
      }),
    );
    return posts;
  }
  const open = async (token: string) => {
    render(<ParticipantsBar shareToken={token} source="shared" crewAsk={false} tripTitle="Tokyo" onSaveForLater={() => {}} />);
    await waitFor(() => expect(countShown()).toBe("1"));
    fireEvent.click(screen.getByTestId("participants-join"));
    return screen.findByTestId("participants-pick-0");
  };

  it("are asked for with the name once they're going, and sent with it in one go", async () => {
    const posts = record(group(1, false), group(2, true));
    const first = await open("token-picks");
    expect(screen.getByText("share.participants.picksPrompt")).toBeTruthy();
    // One box at a time: the next shows once the one before holds something.
    expect(screen.queryByTestId("participants-pick-1")).toBeNull();
    fireEvent.change(first, { target: { value: "teamLab Planets" } });
    fireEvent.change(await screen.findByTestId("participants-pick-1"), { target: { value: "Ichiran ramen" } });
    expect(screen.getByTestId("participants-pick-2")).toBeTruthy();
    fireEvent.change(screen.getByTestId("participants-name"), { target: { value: "Bo" } });
    fireEvent.click(screen.getByText("share.participants.save"));
    await screen.findByPlaceholderText("share.participants.emailPlaceholder");
    expect(posts).toEqual([
      { source: "shared", locale: "en", action: "join" },
      { source: "shared", locale: "en", action: "update", display_name: "Bo", picks: ["teamLab Planets", "Ichiran ramen"] },
    ]);
  });

  it("never hide a pick that is still kept", async () => {
    record(group(1, false), group(2, true));
    const first = await open("token-picks-hide");
    fireEvent.change(first, { target: { value: "teamLab Planets" } });
    fireEvent.change(await screen.findByTestId("participants-pick-1"), { target: { value: "Ichiran ramen" } });
    fireEvent.change(screen.getByTestId("participants-pick-2"), { target: { value: "Shibuya Sky" } });
    fireEvent.change(screen.getByTestId("participants-pick-1"), { target: { value: "" } });
    expect((screen.getByTestId("participants-pick-2") as HTMLInputElement).value).toBe("Shibuya Sky");
  });

  it("go without a name, and say where they went", async () => {
    const nameless = { ...group(1, false), me: { joined: false, display_name: null, has_email: false } };
    const posts = record(nameless, { ...group(2, true), me: { joined: true, display_name: null, has_email: true } });
    const first = await open("token-picks-only");
    fireEvent.change(first, { target: { value: "  Ghibli Museum  " } });
    fireEvent.click(screen.getByText("share.participants.save"));
    expect((await screen.findByTestId("participants-done")).textContent).toContain("share.participants.picksSent");
    expect(posts.at(-1)).toEqual({ source: "shared", locale: "en", action: "update", picks: ["Ghibli Museum"] });
  });

  it("aren't said to be sent when only a name was", async () => {
    const posts = record(group(1, false), { ...group(2, true), me: { joined: true, display_name: "Bo", has_email: true } });
    await open("token-name-only");
    fireEvent.change(screen.getByTestId("participants-name"), { target: { value: "Bo" } });
    fireEvent.click(screen.getByText("share.participants.save"));
    expect((await screen.findByTestId("participants-done")).textContent).not.toContain("share.participants.picksSent");
    expect(posts.at(-1)).toEqual({ source: "shared", locale: "en", action: "update", display_name: "Bo" });
  });

  it("start from the ones they added before", async () => {
    const back = { ...group(2, true), me: { joined: true, display_name: "Bo", has_email: true, picks: ["Ghibli Museum", "Shibuya Sky"] } };
    record(group(1, false), back);
    const first = await open("token-picks-back");
    await waitFor(() => expect((first as HTMLInputElement).value).toBe("Ghibli Museum"));
    expect((screen.getByTestId("participants-pick-1") as HTMLInputElement).value).toBe("Shibuya Sky");
    expect(screen.getByTestId("participants-pick-2")).toBeTruthy();
  });
});
