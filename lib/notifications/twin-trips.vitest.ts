import { describe, it, expect } from "vitest";
import { normalizeTripTitle, twinDecision, twinKeeper, type TwinCandidate } from "./twin-trips";

const DUE = "2026-09-23T06:00:00Z";

const t = (
  id: string,
  updatedAt: string | null,
  slotStatus: string | null,
  slotSentAt: string | null = null
): TwinCandidate => ({ id, updatedAt, slotStatus, slotSentAt });

/**
 * Simulates the cron over one slot for a twin set: a first pass in the given
 * row order, then a final pass over the rows that waited — exactly the shape
 * of the GET handler. `sendOutcome` decides whether a copy's own send
 * succeeds (a real send can fail on its own gates or on Resend).
 */
function simulateRun(
  set: { id: string; updatedAt: string; status?: string }[],
  order: string[],
  sendOutcome: (id: string) => "sent" | "failed" = () => "sent"
): { sent: string[]; statuses: Map<string, string> } {
  const statuses = new Map(set.map((s) => [s.id, s.status ?? "pending"]));
  const sentAt = new Map<string, string>();
  const updated = new Map(set.map((s) => [s.id, s.updatedAt]));
  const view = () => [...statuses].map(([id, st]) => t(id, updated.get(id) ?? null, st, sentAt.get(id) ?? null));
  const sent: string[] = [];
  const process = (id: string, finalPass: boolean): "waited" | "done" => {
    if (statuses.get(id) !== "pending") return "done";
    const d = twinDecision(id, view(), DUE, finalPass);
    if (d.action === "wait") return "waited";
    if (d.action === "suppress") {
      statuses.set(id, "suppressed");
      return "done";
    }
    const outcome = sendOutcome(id);
    statuses.set(id, outcome);
    if (outcome === "sent") {
      sent.push(id);
      sentAt.set(id, "2026-09-23T07:01:00Z");
    }
    return "done";
  };
  const waiting = order.filter((id) => process(id, false) === "waited");
  for (const id of waiting) process(id, true);
  return { sent, statuses };
}

const SEDONA = [
  { id: "sedona-1", updatedAt: "2026-09-10T08:00:00Z" },
  { id: "sedona-2", updatedAt: "2026-09-14T08:00:00Z" },
  { id: "sedona-3", updatedAt: "2026-09-20T08:00:00Z" },
];

describe("normalizeTripTitle", () => {
  it("ignores case and whitespace", () => {
    expect(normalizeTripTitle("  Two weeks in   SEDONA ")).toBe(normalizeTripTitle("two weeks in sedona"));
  });
  it("treats a missing title as empty", () => {
    expect(normalizeTripTitle(null)).toBe("");
    expect(normalizeTripTitle(undefined)).toBe("");
  });
});

describe("twinKeeper", () => {
  it("a lone trip always sends", () => {
    expect(twinKeeper("a", [t("a", "2026-09-20T00:00:00Z", "pending")], DUE)).toBe("a");
    expect(twinKeeper("a", [], DUE)).toBe("a");
  });

  it("a copy that cannot send the slot never wins, so the email is not lost", () => {
    expect(twinKeeper("older", [t("older", "2026-09-01T00:00:00Z", "pending"), t("newest", "2026-09-22T00:00:00Z", null)], DUE)).toBe("older");
    expect(
      twinKeeper("older", [t("older", "2026-09-01T00:00:00Z", "pending"), t("newest", "2026-09-22T00:00:00Z", "suppressed")], DUE)
    ).toBe("older");
  });

  it("ties on updated_at break the same way for every caller", () => {
    const view = [t("b", "2026-09-10T00:00:00Z", "pending"), t("a", "2026-09-10T00:00:00Z", "pending")];
    expect(twinKeeper("a", view, DUE)).toBe(twinKeeper("b", view, DUE));
  });

  // Review finding: a "sent" row left over from before a trip's dates moved
  // must not make the person miss the reminder for the new dates.
  it("a send from before the trip's dates moved does not count", () => {
    const view = [t("moved", "2026-09-22T00:00:00Z", "sent", "2026-08-01T06:00:00Z"), t("fresh", "2026-09-01T00:00:00Z", "pending")];
    expect(twinKeeper("fresh", view, DUE)).toBe("fresh");
  });
});

describe("the cron over a twin set (first pass + final pass)", () => {
  // The measured case: three live copies of Sedona, all pending for
  // pack_early_14d, dispatched in one run (07:00:59, 07:01:00, 07:01:08 on
  // 2026-09-23). Exactly one may send, whatever the row order.
  it("Sedona x3: exactly one email, the newest copy, in either order", () => {
    expect(simulateRun(SEDONA, ["sedona-1", "sedona-2", "sedona-3"]).sent).toEqual(["sedona-3"]);
    expect(simulateRun(SEDONA, ["sedona-3", "sedona-2", "sedona-1"]).sent).toEqual(["sedona-3"]);
    expect(simulateRun(SEDONA, ["sedona-2", "sedona-3", "sedona-1"]).sent).toEqual(["sedona-3"]);
  });

  it("the duplicates end up suppressed only after the chosen copy sent", () => {
    const { statuses } = simulateRun(SEDONA, ["sedona-1", "sedona-2", "sedona-3"]);
    expect(statuses.get("sedona-3")).toBe("sent");
    expect(statuses.get("sedona-1")).toBe("suppressed");
    expect(statuses.get("sedona-2")).toBe("suppressed");
  });

  // THE review finding. The first version suppressed the older copies up
  // front; if the chosen copy then failed its own send, nobody got the email,
  // and whether that happened depended on the row order.
  it("if the chosen copy fails, another copy still sends — in either order", () => {
    const newestFails = (id: string) => (id === "sedona-3" ? "failed" : "sent");
    for (const order of [
      ["sedona-1", "sedona-2", "sedona-3"],
      ["sedona-3", "sedona-1", "sedona-2"],
      ["sedona-2", "sedona-3", "sedona-1"],
    ]) {
      const { sent } = simulateRun(SEDONA, order, newestFails);
      expect(sent).toHaveLength(1);
      expect(sent[0]).not.toBe("sedona-3");
    }
  });

  it("a waiting copy never waits into a lost email: on the final pass it sends", () => {
    // The chosen copy is still pending on the final pass (the send cap or
    // the row limit cut it): the waiting copy sends rather than go stale.
    const view = [t("chosen", "2026-09-22T00:00:00Z", "pending"), t("waiting", "2026-09-01T00:00:00Z", "pending")];
    expect(twinDecision("waiting", view, DUE, false)).toEqual({ action: "wait", keeperId: "chosen" });
    expect(twinDecision("waiting", view, DUE, true)).toEqual({ action: "send" });
    // ...and when the chosen copy's own turn comes, it yields to the one that sent.
    const later = [t("chosen", "2026-09-22T00:00:00Z", "pending"), t("waiting", "2026-09-01T00:00:00Z", "sent", "2026-09-23T07:01:00Z")];
    expect(twinDecision("chosen", later, DUE, false)).toEqual({ action: "suppress", keeperId: "waiting" });
  });

  // Bari: two copies, in-trip digests went out twice a day for six days.
  it("Bari x2: a copy that already sent this slot today wins, and the other is suppressed", () => {
    const view = [t("bari-old", "2026-09-01T00:00:00Z", "sent", "2026-09-23T06:00:30Z"), t("bari-new", "2026-09-05T00:00:00Z", "pending")];
    expect(twinDecision("bari-new", view, DUE, false)).toEqual({ action: "suppress", keeperId: "bari-old" });
  });

  it("a lone trip is never held back", () => {
    expect(twinDecision("solo", [t("solo", "2026-09-01T00:00:00Z", "pending")], DUE, false)).toEqual({ action: "send" });
  });
});

/**
 * Departure morning, as the second review traced it: "Travel day" (morning_of)
 * and the day-2 digest are due at the same moment on every copy, and the
 * cron allows one email per trip per day. The limit must span the twin set:
 * counted per trip id, the older copy's digest went out after the chosen
 * copy had already sent "Travel day" — two emails that morning.
 */
function simulateMorning(sharedLimit: boolean): string[] {
  const updated: Record<string, string> = { A: "2026-09-01T00:00:00Z", B: "2026-09-10T00:00:00Z" };
  const status = new Map<string, string>([
    ["A:morning_of", "pending"], ["B:morning_of", "pending"],
    ["A:day2", "pending"], ["B:day2", "pending"],
  ]);
  const sentAt = new Map<string, string>();
  const emails: string[] = [];
  const view = (slot: string) =>
    ["A", "B"].map((id) => t(id, updated[id], status.get(id + ":" + slot) ?? null, sentAt.get(id + ":" + slot) ?? null));
  const sentToday = (ids: string[]) =>
    [...status].some(([key, st]) => st === "sent" && ids.includes(key.split(":")[0]));
  const process = (id: string, slot: string, finalPass: boolean): "waited" | "done" => {
    const key = id + ":" + slot;
    if (status.get(key) !== "pending") return "done";
    const d = twinDecision(id, view(slot), DUE, finalPass);
    if (d.action === "wait") return "waited";
    if (d.action === "suppress") { status.set(key, "suppressed"); return "done"; }
    // The rate limit runs AFTER the twin decision, as in the route.
    if (sentToday(sharedLimit ? ["A", "B"] : [id])) { status.set(key, "suppressed"); return "done"; }
    status.set(key, "sent");
    sentAt.set(key, "2026-09-23T06:00:30Z");
    emails.push(key);
    return "done";
  };
  // prioritizeDueRows puts morning_of before the digest; within a slot the
  // older copy happens to come first — the order the review used.
  const order: [string, string][] = [["A", "morning_of"], ["B", "morning_of"], ["A", "day2"], ["B", "day2"]];
  const waiting = order.filter(([id, slot]) => process(id, slot, false) === "waited");
  for (const [id, slot] of waiting) process(id, slot, true);
  return emails;
}

describe("departure morning with two copies", () => {
  it("sends exactly one email when the daily limit spans the twin set", () => {
    expect(simulateMorning(true)).toEqual(["B:morning_of"]);
  });
  it("(the defect) a per-trip limit lets the abandoned copy's digest out too", () => {
    expect(simulateMorning(false)).toEqual(["B:morning_of", "A:day2"]);
  });
});
