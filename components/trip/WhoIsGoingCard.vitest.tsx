/** @vitest-environment jsdom */
/**
 * The owner's "Who's going" shows the whole group with each person's role,
 * whether they're a guest, and who only follows along. Remove is offered only
 * where taking back "I'm going" takes someone out of the group.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import WhoIsGoingCard from "./WhoIsGoingCard";
import type { OwnerParticipant } from "@/lib/participants/shared";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: { count?: number }) => (values?.count !== undefined ? `${key}:${values.count}` : key),
  useLocale: () => "en",
}));

const member = (over: Partial<OwnerParticipant>): OwnerParticipant => ({
  id: "x",
  display_name: null,
  role: null,
  going: false,
  in_split: true,
  has_account: true,
  has_email: false,
  joined_at: null,
  participant_id: null,
  ...over,
});

const group = [
  member({ id: "owner-1", display_name: "Olive", role: "owner" }),
  member({ id: "row-m", display_name: "Luca", role: "editor", going: true, joined_at: "2026-10-01T10:00:00Z", participant_id: "row-m" }),
  member({ id: "viewer-1", display_name: "Ugo", role: "viewer", in_split: false }),
  member({ id: "row-v2", display_name: "Vi", role: "viewer", going: true, joined_at: "2026-10-01T11:00:00Z", participant_id: "row-v2" }),
  member({ id: "row-g", display_name: "Bo", going: true, has_account: false, has_email: true, joined_at: "2026-10-01T12:00:00Z", participant_id: "row-g" }),
];

afterEach(() => vi.unstubAllGlobals());

const serve = (...responses: Array<{ count: number; participants: OwnerParticipant[] }>) => {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (init?.method === "DELETE") return new Response("{}", { status: 200 });
      return new Response(JSON.stringify(responses.shift() ?? { count: 0, participants: [] }), { status: 200 });
    }),
  );
  return calls;
};

const rowOf = (name: string) => screen.getByText(name).closest("li") as HTMLElement;

describe("WhoIsGoingCard", () => {
  it("shows everyone, counts who shares costs, and labels guests and followers", async () => {
    serve({ count: 4, participants: group });
    render(<WhoIsGoingCard tripId="trip-1" />);
    await screen.findByText("Olive");
    expect(screen.getAllByTestId("who-is-going-row")).toHaveLength(5);
    expect(screen.getByText("share.participants.going:4")).toBeTruthy();
    expect(rowOf("Olive").textContent).toContain("collaborators.owner");
    expect(rowOf("Ugo").textContent).toContain("roles.viewer.label · share.participants.followingAlong");
    expect(rowOf("Bo").textContent).toContain("share.participants.guest · share.participants.getsUpdates");
    expect(screen.queryByText("share.participants.noneYet")).toBeNull();
  });

  it("offers Remove only where it takes someone out of the group", async () => {
    serve({ count: 4, participants: group });
    render(<WhoIsGoingCard tripId="trip-1" />);
    await screen.findByText("Olive");
    const withRemove = screen.getAllByText("share.participants.remove").map((b) => b.closest("li")?.textContent ?? "");
    expect(withRemove).toHaveLength(2);
    expect(withRemove[0]).toContain("Vi");
    expect(withRemove[1]).toContain("Bo");
  });

  it("reads the group again after a removal", async () => {
    const calls = serve({ count: 4, participants: group }, { count: 3, participants: group.filter((p) => p.id !== "row-g") });
    render(<WhoIsGoingCard tripId="trip-1" />);
    await screen.findByText("Bo");
    fireEvent.click(rowOf("Bo").querySelector("button") as HTMLElement);
    await waitFor(() => expect(screen.queryByText("Bo")).toBeNull());
    expect(calls).toEqual(["GET /api/trips/trip-1/participants", "DELETE /api/trips/trip-1/participants/row-g", "GET /api/trips/trip-1/participants"]);
    expect(screen.getByText("share.participants.going:3")).toBeTruthy();
  });

  it("asks the owner to send the link while they are alone", async () => {
    serve({ count: 1, participants: [group[0]] });
    render(<WhoIsGoingCard tripId="trip-1" />);
    await screen.findByText("Olive");
    expect(screen.getByText("share.participants.noneYet")).toBeTruthy();
  });
});
