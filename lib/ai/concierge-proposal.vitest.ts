import { describe, it, expect } from "vitest";
import {
  PROPOSAL_MARKER,
  emittableLength,
  splitAnswerAndProposal,
  resolveConciergeProposal,
  proposalOwed,
  proposalRequest,
  requestedProposalJson,
} from "./concierge-proposal";
import type { Activity, ItineraryDay } from "@/types";

function act(id: string, name: string, locked = false): Activity {
  return {
    id,
    name,
    type: "attraction" as Activity["type"],
    description: "",
    location: "Centro",
    time_slot: "morning",
    start_time: "10:00",
    duration_minutes: 120,
    estimated_cost: { amount: 10, currency: "EUR", tier: "budget" },
    tips: [],
    booking_required: false,
    ...(locked ? { locked: true } : {}),
  } as Activity;
}

const ITINERARY: ItineraryDay[] = [
  {
    day_number: 1,
    date: "2026-09-01",
    activities: [act("act_aaa", "Museo Egizio"), act("act_bbb", "Mole Antonelliana")],
  },
  {
    day_number: 2,
    date: "2026-09-02",
    activities: [act("act_ccc", "Wedding dinner", true)],
  },
];

describe("emittableLength (streaming holdback)", () => {
  it("emits everything when no marker is near", () => {
    expect(emittableLength("Plain answer text.")).toBe("Plain answer text.".length);
  });

  it("holds back a trailing partial marker until disambiguated", () => {
    const text = "Answer text <<<PROP";
    // "<<<PROP" is a prefix of the marker — must not be emitted yet.
    expect(emittableLength(text)).toBe("Answer text ".length);
  });

  it("stops at the marker once it fully arrives", () => {
    const text = `Answer.${PROPOSAL_MARKER}{"type":"remove"}`;
    expect(emittableLength(text)).toBe("Answer.".length);
  });

  it("does not hold back ordinary angle brackets", () => {
    const text = "Use the A<->B tram";
    expect(emittableLength(text)).toBe(text.length);
  });
});

describe("splitAnswerAndProposal", () => {
  it("returns the whole text as answer when there is no marker", () => {
    expect(splitAnswerAndProposal("Just an answer.")).toEqual({
      answer: "Just an answer.",
      proposalJson: null,
    });
  });

  it("splits answer and JSON at the marker", () => {
    const { answer, proposalJson } = splitAnswerAndProposal(
      `Swap it for the market.\n${PROPOSAL_MARKER}{"type":"remove","dayNumber":1}`
    );
    expect(answer).toBe("Swap it for the market.");
    expect(proposalJson).toBe('{"type":"remove","dayNumber":1}');
  });
});

describe("proposalOwed (an answer that came without its proposal)", () => {
  it("is owed when the answer hands over or claims a change", () => {
    expect(proposalOwed("ok", "Ho ricevuto la tua conferma. Ecco la proposta per rimuovere Restaurace Mlejnice dal Giorno 2.")).toBe("promised");
    expect(proposalOwed("add a museum", "I've added the Egyptian Museum to Day 1.")).toBe("promised");
  });

  it("is owed for a short yes, which may agree to an earlier offer", () => {
    expect(proposalOwed("sì", "Perfetto!")).toBe("confirmed");
  });

  it("is owed for an offer that asks nothing back, not for one that asks", () => {
    expect(proposalOwed("togliamo il ristorante alla sera", "Certo, posso rimuovere la cena al Restaurace Mlejnice dal Giorno 2.")).toBe("offered");
    expect(proposalOwed("aggiungi la gita in battello", "Certo, posso aggiungere una gita in battello. In quale giorno?")).toBeNull();
    expect(proposalOwed("how do I put my hotel in?", "I can add your hotel. What is its name?")).toBeNull();
  });

  it("is not owed for an answer", () => {
    expect(proposalOwed("what's the best time to visit the castle?", "Early morning, right at opening.")).toBeNull();
  });
});

describe("the follow-up that asks for the owed proposal", () => {
  it("asks for the line alone, with its day, or NONE", () => {
    const text = proposalRequest("offered");
    expect(text).toContain(PROPOSAL_MARKER);
    expect(text).toContain("dayNumber");
    expect(text).toContain("NONE");
    expect(proposalRequest("confirmed")).toContain("agrees to a change offered earlier");
  });

  it("reads the line with or without the marker, and a NONE", () => {
    const json = '{"type":"remove","dayNumber":2,"targetActivityId":"act_x"}';
    expect(requestedProposalJson(`${PROPOSAL_MARKER} ${json}`)).toBe(json);
    expect(requestedProposalJson(json)).toBe(json);
    expect(requestedProposalJson("```json\n" + json + "\n```")).toBe(json);
    expect(requestedProposalJson("NONE")).toBe("none");
    expect(requestedProposalJson("None.")).toBe("none");
    expect(requestedProposalJson("Sure, here it is.")).toBeNull();
  });
});

describe("resolveConciergeProposal", () => {
  it("resolves a remove against the STORED activity (never the model's copy)", () => {
    const p = resolveConciergeProposal(
      JSON.stringify({ type: "remove", dayNumber: 1, targetActivityId: "act_aaa", reason: "Rainy" }),
      ITINERARY,
      "EUR"
    );
    expect(p).toMatchObject({ type: "remove", dayNumber: 1, reason: "Rainy" });
    // The full stored object, not a reconstruction:
    expect((p as { oldActivity: Activity }).oldActivity.name).toBe("Museo Egizio");
    expect((p as { oldActivity: Activity }).oldActivity.duration_minutes).toBe(120);
  });

  it("builds replace with a sanitized newActivity inheriting the old start_time", () => {
    const p = resolveConciergeProposal(
      JSON.stringify({
        type: "replace",
        dayNumber: 1,
        targetActivityId: "act_bbb",
        newActivity: { name: "Palazzo Madama", type: "attraction", duration_minutes: 5000 },
      }),
      ITINERARY,
      "EUR"
    );
    expect(p?.type).toBe("replace");
    const np = (p as { newActivity: Activity }).newActivity;
    expect(np.name).toBe("Palazzo Madama");
    expect(np.start_time).toBe("10:00"); // inherited
    expect(np.duration_minutes).toBe(480); // clamped
    expect(np.estimated_cost?.currency).toBe("EUR"); // trip currency default
    expect(np.id).toMatch(/^act_/); // stamped
  });

  it("computes adjust_duration's oldDuration from the stored activity", () => {
    const p = resolveConciergeProposal(
      JSON.stringify({ type: "adjust_duration", dayNumber: 1, targetActivityId: "act_aaa", newDuration: 60 }),
      ITINERARY
    );
    expect(p).toMatchObject({ type: "adjust_duration", oldDuration: 120, newDuration: 60 });
  });

  it("drops proposals that target locked (anchored) activities", () => {
    const p = resolveConciergeProposal(
      JSON.stringify({ type: "remove", dayNumber: 2, targetActivityId: "act_ccc" }),
      ITINERARY
    );
    expect(p).toBeNull();
  });

  it("drops unknown types, unknown days, missing targets, and broken JSON", () => {
    expect(
      resolveConciergeProposal(JSON.stringify({ type: "shift_days", dayNumber: 1 }), ITINERARY)
    ).toBeNull();
    expect(
      resolveConciergeProposal(JSON.stringify({ type: "add", dayNumber: 9, newActivity: { name: "Eataly" } }), ITINERARY)
    ).toBeNull();
    expect(
      resolveConciergeProposal(JSON.stringify({ type: "remove", dayNumber: 1, targetActivityId: "nope" }), ITINERARY)
    ).toBeNull();
    expect(resolveConciergeProposal("{not json", ITINERARY)).toBeNull();
  });

  // The model followed the old field rule "remove → targetActivityId only":
  // every removal came without its day and was dropped.
  it("finds the day of a change to a stored activity from the activity", () => {
    const p = resolveConciergeProposal(
      JSON.stringify({ type: "remove", targetActivityId: "act_bbb", reason: "Too tired" }),
      ITINERARY
    );
    expect(p).toMatchObject({ type: "remove", dayNumber: 1 });
    expect((p as { oldActivity: Activity }).oldActivity.name).toBe("Mole Antonelliana");
    expect(
      resolveConciergeProposal(JSON.stringify({ type: "adjust_duration", targetActivityId: "act_aaa", newDuration: 60 }), ITINERARY)
    ).toMatchObject({ type: "adjust_duration", dayNumber: 1 });
  });

  it("takes the day that holds the activity over a wrong day number", () => {
    const p = resolveConciergeProposal(
      JSON.stringify({ type: "remove", dayNumber: 9, targetActivityId: "act_aaa" }),
      ITINERARY
    );
    expect(p).toMatchObject({ type: "remove", dayNumber: 1 });
  });

  it("still needs the day for an add, and keeps locked activities out", () => {
    expect(resolveConciergeProposal(JSON.stringify({ type: "add", newActivity: { name: "Eataly" } }), ITINERARY)).toBeNull();
    expect(resolveConciergeProposal(JSON.stringify({ type: "remove", targetActivityId: "act_ccc" }), ITINERARY)).toBeNull();
  });

  it("falls back to name matching when the model echoes the name instead of the id", () => {
    const p = resolveConciergeProposal(
      JSON.stringify({ type: "remove", dayNumber: 1, targetActivityName: "Mole Antonelliana" }),
      ITINERARY
    );
    expect((p as { oldActivity: Activity }).oldActivity.id).toBe("act_bbb");
  });

  it("resolves shift_days with the affected range and post-shift end date", () => {
    const noLocks: ItineraryDay[] = [
      { day_number: 1, date: "2026-09-01", activities: [act("a1", "One")] },
      { day_number: 2, date: "2026-09-02", activities: [act("a2", "Two")] },
      { day_number: 3, date: "2026-09-03", activities: [act("a3", "Three")] },
    ];
    const p = resolveConciergeProposal(
      JSON.stringify({ type: "shift_days", dayNumber: 2, shiftByDays: 2, reason: "Flight cancelled" }),
      noLocks
    );
    expect(p).toMatchObject({
      type: "shift_days",
      dayNumber: 2,
      shiftByDays: 2,
      lastDayNumber: 3,
      newLastDate: "2026-09-05",
      reason: "Flight cancelled",
    });
  });

  it("rejects shift_days with out-of-bounds K and when the range holds a locked day", () => {
    const noLocks: ItineraryDay[] = [
      { day_number: 1, date: "2026-09-01", activities: [act("a1", "One")] },
    ];
    expect(
      resolveConciergeProposal(JSON.stringify({ type: "shift_days", dayNumber: 1, shiftByDays: 0 }), noLocks)
    ).toBeNull();
    expect(
      resolveConciergeProposal(JSON.stringify({ type: "shift_days", dayNumber: 1, shiftByDays: 9 }), noLocks)
    ).toBeNull();
    // ITINERARY day 2 is locked — shifting from day 1 sweeps it in.
    expect(
      resolveConciergeProposal(JSON.stringify({ type: "shift_days", dayNumber: 1, shiftByDays: 1 }), ITINERARY)
    ).toBeNull();
  });

  it("rejects an add without a usable name; accepts one with defaults filled", () => {
    expect(
      resolveConciergeProposal(JSON.stringify({ type: "add", dayNumber: 1, newActivity: {} }), ITINERARY)
    ).toBeNull();
    const p = resolveConciergeProposal(
      JSON.stringify({ type: "add", dayNumber: 1, newActivity: { name: "Aperitivo in Vanchiglia", start_time: "18:30" } }),
      ITINERARY,
      "EUR"
    );
    expect(p?.type).toBe("add");
    const np = (p as { newActivity: Activity }).newActivity;
    expect(np.time_slot).toBe("evening"); // derived from start_time
    expect(np.duration_minutes).toBe(90); // default
  });
});
