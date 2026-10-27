import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A collaborator's vote reaches the trip owner as an email. It used to drop
 * the trip (the email named the trip by its id) and to read every vote
 * except "love" as "no".
 */

const dispatchEmail = vi.fn(async () => undefined);
let tripLookupError: { message: string } | null = null;

vi.mock("@/lib/email/send", () => ({ dispatchEmail }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const row =
        table === "users"
          ? { email: "owner@example.com" }
          : table === "trips"
            ? { title: "Lisbon long weekend", trip_meta: { destination: "Lisbon, Portugal" } }
            : null;
      const chain = {
        select: () => chain,
        eq: () => chain,
        is: () => chain,
        maybeSingle: async () =>
          table === "trips" && tripLookupError ? { data: null, error: tripLookupError } : { data: row, error: null },
      };
      return chain;
    },
  }),
}));

const { sendVoteEmail } = await import("./vote-email");

const vote = (kind: "love" | "flexible" | "concerns" | "no") =>
  sendVoteEmail({
    ownerId: "owner-1",
    voterId: "voter-1",
    tripId: "trip-1",
    activityId: "act-1",
    voterName: "Sam",
    activityLabel: "Tram 28",
    vote: kind,
  });

type EmailArgs = { idempotencyKey: string; template: { props: Record<string, unknown> } };
const sent = () => (dispatchEmail.mock.calls.at(-1) as unknown as [EmailArgs])[0];

beforeEach(() => {
  dispatchEmail.mockClear();
  tripLookupError = null;
});

describe("vote email", () => {
  it("names the trip, not its id", async () => {
    await vote("love");
    expect(sent().template.props).toMatchObject({
      tripTitle: "Lisbon long weekend",
      tripDestination: "Lisbon, Portugal",
      activityLabel: "Tram 28",
      tripUrl: expect.stringMatching(/\/trips\/trip-1$/),
    });
  });

  it.each(["love", "flexible", "concerns", "no"] as const)("reports a %s vote as it was cast", async (kind) => {
    await vote(kind);
    expect(sent().template.props.voteType).toBe(kind);
  });

  it("sends once per voter and activity", async () => {
    await vote("love");
    expect(sent().idempotencyKey).toBe("vote:trip-1:act-1:voter-1");
  });

  it("says why the email didn't go when the trip can't be read", async () => {
    tripLookupError = { message: "statement timeout" };
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await vote("love");
      expect(logged).toHaveBeenCalledWith(
        "[notifications] email lookup failed",
        expect.objectContaining({ table: "trips", error: "statement timeout" }),
      );
      expect(dispatchEmail).not.toHaveBeenCalled();
    } finally {
      logged.mockRestore();
    }
  });
});
