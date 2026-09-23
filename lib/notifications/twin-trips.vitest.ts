import { describe, it, expect } from "vitest";
import { normalizeTripTitle, twinKeeper, type TwinCandidate } from "./twin-trips";

const t = (id: string, updatedAt: string | null, slotStatus: string | null): TwinCandidate => ({
  id,
  updatedAt,
  slotStatus,
});

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
    expect(twinKeeper("a", [t("a", "2026-09-20T00:00:00Z", "pending")])).toBe("a");
    expect(twinKeeper("a", [])).toBe("a");
  });

  // The measured case: three live copies of Sedona, all pending for
  // pack_early_14d, dispatched one after another in the same cron run
  // (07:00:59, 07:01:00, 07:01:08 on 2026-09-23). Exactly one may send.
  it("Sedona x3 in one run: only the newest copy sends, whichever row comes first", () => {
    const run = [
      t("sedona-1", "2026-09-10T08:00:00Z", "pending"),
      t("sedona-2", "2026-09-14T08:00:00Z", "pending"),
      t("sedona-3", "2026-09-20T08:00:00Z", "pending"),
    ];
    const statuses = new Map(run.map((r) => [r.id, r.slotStatus]));
    const senders: string[] = [];
    for (const current of ["sedona-1", "sedona-2", "sedona-3"]) {
      const view = run.map((r) => ({ ...r, slotStatus: statuses.get(r.id) ?? null }));
      const keeper = twinKeeper(current, view);
      if (keeper === current) {
        senders.push(current);
        statuses.set(current, "sent");
      } else {
        statuses.set(current, "suppressed");
      }
    }
    expect(senders).toEqual(["sedona-3"]);
  });

  it("same outcome when the rows arrive newest-first", () => {
    const statuses = new Map<string, string>([
      ["sedona-1", "pending"],
      ["sedona-2", "pending"],
      ["sedona-3", "pending"],
    ]);
    const updated: Record<string, string> = {
      "sedona-1": "2026-09-10T08:00:00Z",
      "sedona-2": "2026-09-14T08:00:00Z",
      "sedona-3": "2026-09-20T08:00:00Z",
    };
    const senders: string[] = [];
    for (const current of ["sedona-3", "sedona-2", "sedona-1"]) {
      const view = [...statuses].map(([id, s]) => t(id, updated[id], s));
      if (twinKeeper(current, view) === current) {
        senders.push(current);
        statuses.set(current, "sent");
      } else {
        statuses.set(current, "suppressed");
      }
    }
    expect(senders).toEqual(["sedona-3"]);
  });

  // Bari: two copies, in-trip digests went out twice a day for six days.
  it("Bari x2: the twin that already sent this slot wins, even if it is older", () => {
    const view = [t("bari-old", "2026-09-01T00:00:00Z", "sent"), t("bari-new", "2026-09-05T00:00:00Z", "pending")];
    expect(twinKeeper("bari-new", view)).toBe("bari-old");
  });

  it("a copy that cannot send the slot never wins, so the email is not lost", () => {
    // The newest copy has no row for this slot (or it was suppressed): the
    // older copy with a pending row must still send.
    expect(
      twinKeeper("older", [t("older", "2026-09-01T00:00:00Z", "pending"), t("newest", "2026-09-22T00:00:00Z", null)])
    ).toBe("older");
    expect(
      twinKeeper("older", [
        t("older", "2026-09-01T00:00:00Z", "pending"),
        t("newest", "2026-09-22T00:00:00Z", "suppressed"),
      ])
    ).toBe("older");
  });

  it("ties on updated_at break the same way for every caller", () => {
    const view = [t("b", "2026-09-10T00:00:00Z", "pending"), t("a", "2026-09-10T00:00:00Z", "pending")];
    expect(twinKeeper("a", view)).toBe(twinKeeper("b", view));
  });

  it("a missing updated_at loses to a known one", () => {
    const view = [t("x", null, "pending"), t("y", "2026-09-10T00:00:00Z", "pending")];
    expect(twinKeeper("x", view)).toBe("y");
  });
});
