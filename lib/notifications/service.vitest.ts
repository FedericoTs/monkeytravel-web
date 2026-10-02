import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A collaborator's vote reaches the trip owner as an email and a push. Both
 * used to drop the trip (the email named the trip by its id) and to read
 * every vote except "love" as "no".
 */

const dispatchEmail = vi.fn(async () => undefined);
const dispatchPush = vi.fn(async () => ({ ok: true }));
let tripLookupError: { message: string } | null = null;

vi.mock("@/lib/email/send", () => ({ dispatchEmail }));
vi.mock("@/lib/push/dispatch", () => ({ dispatchPush }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const row =
        table === "notifications"
          ? { id: "notification-1" }
          : table === "users"
            ? { email: "owner@example.com", display_name: "Owner", preferred_language: "en" }
            : table === "trips"
              ? { title: "Lisbon long weekend", trip_meta: { destination: "Lisbon, Portugal" } }
              : null;
      const chain = {
        insert: () => chain,
        select: () => chain,
        eq: () => chain,
        is: () => chain,
        single: async () => ({ data: row, error: null }),
        maybeSingle: async () =>
          table === "trips" && tripLookupError ? { data: null, error: tripLookupError } : { data: row, error: null },
      };
      return chain;
    },
  }),
}));

const { enqueueNotification } = await import("./service");

function vote(data: { vote_type: "up" | "down"; vote?: "love" | "flexible" | "concerns" | "no" }) {
  return enqueueNotification({
    userId: "owner-1",
    notification: {
      type: "collab_vote",
      data: {
        message: "Sam voted on an activity in your trip",
        href: "/trips/trip-1",
        trip_id: "trip-1",
        voter_name: "Sam",
        activity_label: "Tram 28",
        ...data,
      },
    },
  });
}

type EmailArgs = { template: { props: Record<string, unknown> } };
const emailProps = () => (dispatchEmail.mock.calls.at(-1) as unknown as [EmailArgs])[0].template.props;
const pushBody = () => (dispatchPush.mock.calls.at(-1) as unknown as [string, { body: string }])[1].body;

beforeEach(() => {
  dispatchEmail.mockClear();
  dispatchPush.mockClear();
  tripLookupError = null;
});

describe("collab_vote email and push", () => {
  it("name the trip, not its id", async () => {
    await vote({ vote_type: "up", vote: "love" });
    await vi.waitFor(() => expect(dispatchEmail).toHaveBeenCalledTimes(1));
    expect(emailProps()).toMatchObject({ tripTitle: "Lisbon long weekend", tripDestination: "Lisbon, Portugal" });
  });

  // The same emoji the voter tapped in the app.
  it.each([
    ["flexible", "👌"],
    ["concerns", "🤔"],
    ["no", "👎"],
    ["love", "😍"],
  ] as const)("report a %s vote as %s, not as no", async (kind, emoji) => {
    await vote({ vote_type: kind === "love" ? "up" : "down", vote: kind });
    await vi.waitFor(() => expect(dispatchPush).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(dispatchEmail).toHaveBeenCalledTimes(1));
    expect(emailProps().voteType).toBe(kind);
    expect(pushBody().startsWith(emoji)).toBe(true);
  });

  it("read older rows without the exact vote from up or down", async () => {
    await vote({ vote_type: "up" });
    await vi.waitFor(() => expect(dispatchEmail).toHaveBeenCalledTimes(1));
    expect(emailProps().voteType).toBe("love");
    dispatchEmail.mockClear();
    await vote({ vote_type: "down" });
    await vi.waitFor(() => expect(dispatchEmail).toHaveBeenCalledTimes(1));
    expect(emailProps().voteType).toBe("no");
  });

  it("say why the email didn't go when the trip can't be read", async () => {
    tripLookupError = { message: "statement timeout" };
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await vote({ vote_type: "up", vote: "love" });
      await vi.waitFor(() =>
        expect(logged).toHaveBeenCalledWith(
          "[notifications] email lookup failed",
          expect.objectContaining({ table: "trips", error: "statement timeout" }),
        ),
      );
      expect(dispatchEmail).not.toHaveBeenCalled();
    } finally {
      logged.mockRestore();
    }
  });
});
