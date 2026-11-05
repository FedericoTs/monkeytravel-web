/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import ConciergeHistory from "./ConciergeHistory";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => (values ? `${key} ${Object.values(values).join(" ")}` : key),
  useLocale: () => "en",
}));

const turn = (id: string, question: string, extra: Record<string, unknown> = {}) => ({
  id,
  question,
  answer: `Answer to ${question}`,
  is_live_trip: false,
  day_number: null,
  created_at: "2026-11-01T10:00:00Z",
  ...extra,
});
const answered = (turns: unknown[]) => new Response(JSON.stringify({ turns }), { status: 200 });

const send = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
const toggle = () => screen.getByRole("button", { name: /historyToggle/ });

beforeEach(() => {
  send.mockReset();
  send.mockImplementation(async () => answered([turn("t1", "Where to eat?")]));
  vi.stubGlobal("fetch", send);
  vi.stubEnv("NEXT_PUBLIC_CONCIERGE_ENABLED", "true");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("past concierge questions", () => {
  it("shows nothing with the concierge switched off", () => {
    vi.stubEnv("NEXT_PUBLIC_CONCIERGE_ENABLED", "false");
    const { container } = render(<ConciergeHistory tripId="trip-1" />);
    expect(container.innerHTML).toBe("");
  });

  it("asks for nothing until it is opened", () => {
    render(<ConciergeHistory tripId="trip-1" />);
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(send).not.toHaveBeenCalled();
  });

  it("reads them when opened, says so meanwhile, and shows them", async () => {
    render(<ConciergeHistory tripId="trip-1" />);
    fireEvent.click(toggle());
    expect(screen.getByText("historyLoading")).toBeTruthy();
    expect(send).toHaveBeenCalledExactlyOnceWith("/api/trips/trip-1/concierge-history", { cache: "no-store" });

    await screen.findByText("Where to eat?");
    expect(screen.getByText("Answer to Where to eat?")).toBeTruthy();
    expect(screen.queryByText("historyLoading")).toBeNull();
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("historyCount 1")).toBeTruthy();
  });

  it("marks what was asked during the trip, with its day when it has one", async () => {
    send.mockImplementation(async () =>
      answered([turn("t1", "Today?", { is_live_trip: true, day_number: 2 }), turn("t2", "Now?", { is_live_trip: true })])
    );
    render(<ConciergeHistory tripId="trip-1" />);
    fireEvent.click(toggle());
    await screen.findByText("historyLiveTripDay 2");
    expect(screen.getByText("historyLiveTrip")).toBeTruthy();
  });

  it("says when there are none", async () => {
    send.mockImplementation(async () => answered([]));
    render(<ConciergeHistory tripId="trip-1" />);
    fireEvent.click(toggle());
    await screen.findByText("historyEmpty");
    expect(screen.queryByText("historyLoading")).toBeNull();
  });

  it("treats a reply without turns as none", async () => {
    send.mockImplementation(async () => new Response("{}", { status: 200 }));
    render(<ConciergeHistory tripId="trip-1" />);
    fireEvent.click(toggle());
    await screen.findByText("historyEmpty");
  });

  it.each([
    ["the route refuses", async () => new Response("{}", { status: 500 })],
    [
      "the network fails",
      async () => {
        throw new Error("offline");
      },
    ],
  ])("says so when %s, and stops loading", async (_name, reply) => {
    send.mockImplementation(reply);
    render(<ConciergeHistory tripId="trip-1" />);
    fireEvent.click(toggle());
    await screen.findByText("historyError");
    expect(screen.queryByText("historyLoading")).toBeNull();
  });

  it("isn't read again when closed and opened again", async () => {
    render(<ConciergeHistory tripId="trip-1" />);
    fireEvent.click(toggle());
    await screen.findByText("Where to eat?");
    fireEvent.click(toggle());
    expect(screen.queryByText("Where to eat?")).toBeNull();
    fireEvent.click(toggle());
    expect(screen.getByText("Where to eat?")).toBeTruthy();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("is ready after being closed while it was being read", async () => {
    let finish!: (res: Response) => void;
    send.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    render(<ConciergeHistory tripId="trip-1" />);
    fireEvent.click(toggle());
    fireEvent.click(toggle());
    await act(async () => finish(answered([turn("t1", "Where to eat?")])));
    fireEvent.click(toggle());
    expect(screen.getByText("Where to eat?")).toBeTruthy();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("isn't read twice when opened again while it is being read", async () => {
    let finish!: (res: Response) => void;
    send.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    render(<ConciergeHistory tripId="trip-1" />);
    fireEvent.click(toggle());
    fireEvent.click(toggle());
    fireEvent.click(toggle());
    expect(send).toHaveBeenCalledTimes(1);
    await act(async () => finish(answered([turn("t1", "Where to eat?")])));
    expect(screen.getByText("Where to eat?")).toBeTruthy();
  });

  it("tries again on the next opening after a failure, and not on closing", async () => {
    send.mockImplementationOnce(async () => new Response("{}", { status: 500 }));
    render(<ConciergeHistory tripId="trip-1" />);
    fireEvent.click(toggle());
    await screen.findByText("historyError");
    fireEvent.click(toggle());
    expect(send).toHaveBeenCalledTimes(1);

    fireEvent.click(toggle());
    expect(screen.queryByText("historyError")).toBeNull();
    await screen.findByText("Where to eat?");
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("drops a reply that lands after the page has gone", async () => {
    let finish!: (res: Response) => void;
    send.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    const view = render(<ConciergeHistory tripId="trip-1" />);
    fireEvent.click(toggle());
    view.unmount();
    await act(async () => finish(answered([turn("t1", "Where to eat?")])));
    expect(console.error).not.toHaveBeenCalled();
  });
});
