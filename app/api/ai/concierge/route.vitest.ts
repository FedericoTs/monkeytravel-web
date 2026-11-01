// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The concierge told a traveller "Ecco la proposta per rimuovere Restaurace
 * Mlejnice dal Giorno 2" and showed nothing to confirm: the model's removal
 * came without its day and was dropped, and nothing noticed the answer
 * promised a change. The real route runs with Gemini, auth and Supabase faked.
 */

let streamReply = "";
let followUps: (string | Error)[] = [];
const followUpRequests: { contents: { role: string; parts: { text: string }[] }[] }[] = [];
const streamRequests: { contents: { role: string; parts: { text: string }[] }[] }[] = [];

vi.mock("@/lib/ai/genai-compat", () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel() {
      return {
        generateContentStream: async (req: (typeof streamRequests)[number]) => {
          streamRequests.push(req);
          const text = streamReply;
          return {
            stream: (async function* () {
              for (let i = 0; i < text.length; i += 7) {
                const piece = text.slice(i, i + 7);
                yield { text: () => piece };
              }
            })(),
            response: Promise.resolve({ usageMetadata: {} }),
          };
        },
        generateContent: async (req: (typeof followUpRequests)[number]) => {
          const isFollowUp = req.contents.length > 0 && req.contents.at(-1)!.parts[0].text.includes("proposal line");
          if (isFollowUp) followUpRequests.push(req);
          else streamRequests.push(req);
          const next = isFollowUp ? (followUps.shift() ?? "NONE") : streamReply;
          if (next instanceof Error) throw next;
          return { response: { text: () => next, usageMetadata: {} } };
        },
      };
    }
  },
}));
vi.mock("@/lib/gemini", () => ({ logCacheMetrics: vi.fn() }));
vi.mock("@/lib/api-gateway", () => ({ checkApiAccess: async () => ({ allowed: true }), logApiCall: vi.fn(async () => {}) }));
vi.mock("@/lib/usage-limits", () => ({ checkUsageLimit: async () => ({ allowed: true }), incrementUsage: vi.fn(async () => {}) }));
vi.mock("@/lib/ai/observability", () => ({ recordAiOutcome: vi.fn(async () => {}) }));

const act = (id: string, name: string, start_time: string) => ({
  id, name, type: "restaurant", time_slot: "evening", start_time, duration_minutes: 90, location: "Città Vecchia",
  estimated_cost: { amount: 25, currency: "EUR", tier: "moderate" },
});
const trip = {
  id: "trip-1",
  title: "Praga",
  start_date: "2026-11-22",
  end_date: "2026-11-23",
  trip_meta: { destination: "Prague, Czech Republic", locale: "it" },
  budget: { currency: "EUR" },
  itinerary: [
    { day_number: 1, date: "2026-11-22", activities: [act("act_c", "Castello di Praga", "09:00")] },
    { day_number: 2, date: "2026-11-23", activities: [act("act_j", "Quartiere Ebraico", "13:30"), act("act_m", "Restaurace Mlejnice", "19:30")] },
  ],
};
let history: [string, string][] = [];
const persisted: { messages: { content: string }[]; context: { proposal_type?: string; surface?: string } }[] = [];
const memoryFilters: [string, unknown][] = [];

vi.mock("@/lib/api/auth", () => ({
  getAuthenticatedUser: async () => ({
    user: { id: "user-1", email: "owner@example.com" },
    errorResponse: null,
    supabase: {
      from(table: string) {
        const chain: Record<string, unknown> = {};
        for (const m of ["select", "eq"]) chain[m] = () => chain;
        chain.maybeSingle = async () => ({ data: table === "trips" ? trip : null, error: null });
        return chain;
      },
    },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from() {
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "order"]) chain[m] = () => chain;
      chain.eq = (column: string, value: unknown) => (memoryFilters.push([column, value]), chain);
      chain.limit = async () => ({
        data: [...history].reverse().map(([q, a]) => ({ messages: [{ role: "user", content: q }, { role: "assistant", content: a }] })),
        error: null,
      });
      chain.insert = async (row: (typeof persisted)[number]) => {
        persisted.push(row);
        return { error: null };
      };
      return chain;
    },
  }),
}));

const { POST } = await import("./route");

// Each ask uses a new itineraryVersion so the route's trip cache is never stale.
let version = 0;
async function ask(question: string, stream = true) {
  const res = await POST(
    new NextRequest("http://localhost/api/ai/concierge", {
      method: "POST",
      headers: stream ? { Accept: "text/event-stream" } : {},
      body: JSON.stringify({ tripId: "trip-1", question, itineraryVersion: ++version }),
    })
  );
  if (!stream) return { json: await res.json() };
  let answer = "";
  let proposal: Record<string, unknown> | null = null;
  for (const frame of (await res.text()).split("\n\n")) {
    const t = frame.trim();
    if (!t.startsWith("data:")) continue;
    const ev = JSON.parse(t.slice(5));
    if (ev.type === "chunk") answer += ev.text;
    if (ev.type === "proposal") proposal = ev.proposal;
  }
  await new Promise((r) => setTimeout(r, 0));
  return { answer: answer.trim(), proposal: proposal as { type?: string; dayNumber?: number; oldActivity?: { name?: string } } | null };
}

const removal = (fields: Record<string, unknown>) => `<<<PROPOSAL>>>${JSON.stringify({ type: "remove", ...fields })}`;

beforeEach(() => {
  vi.stubEnv("GOOGLE_AI_API_KEY", "test-key");
  streamReply = "";
  followUps = [];
  followUpRequests.length = 0;
  streamRequests.length = 0;
  history = [];
  persisted.length = 0;
  memoryFilters.length = 0;
});

describe("concierge proposals", () => {
  it("offers a removal the model sent without its day", async () => {
    streamReply = `Certo, posso rimuovere la cena al Restaurace Mlejnice dal Giorno 2. ${removal({ targetActivityId: "act_m" })}`;
    const { answer, proposal } = await ask("togliamo il ristorante alla sera");
    expect(proposal).toMatchObject({ type: "remove", dayNumber: 2, oldActivity: { name: "Restaurace Mlejnice" } });
    expect(answer).toBe("Certo, posso rimuovere la cena al Restaurace Mlejnice dal Giorno 2.");
    expect(followUpRequests).toHaveLength(0);
    expect(persisted[0].context.proposal_type).toBe("remove");
  });

  it("asks once more for the proposal an answer hands over without one", async () => {
    streamReply = "Ecco la proposta per rimuovere Restaurace Mlejnice dal Giorno 2.";
    followUps = [removal({ dayNumber: 2, targetActivityId: "act_m" })];
    const { answer, proposal } = await ask("ok");
    expect(proposal).toMatchObject({ type: "remove", dayNumber: 2 });
    expect(answer).toBe("Ecco la proposta per rimuovere Restaurace Mlejnice dal Giorno 2.");
    // The follow-up sees the answer it is completing.
    const turns = followUpRequests[0].contents;
    expect(turns.at(-2)).toMatchObject({ role: "model", parts: [{ text: answer }] });
    expect(persisted[0].context.proposal_type).toBe("remove");
  });

  it("says so when the change it handed over still can't be attached", async () => {
    streamReply = "Ecco la proposta per rimuovere Restaurace Mlejnice dal Giorno 2.";
    followUps = [removal({ dayNumber: 2, targetActivityId: "not-in-the-trip" })];
    const { answer, proposal } = await ask("ok");
    expect(proposal).toBeNull();
    expect(answer).toMatch(/Giorno 2\.\s+\(Questa modifica non è pronta/);
    expect(persisted[0].messages[1].content).toBe(answer);
  });

  it("adds nothing when the follow-up finds no change to propose", async () => {
    streamReply = "Certo, posso aggiungere una gita in battello: partono vicino al Ponte Carlo.";
    followUps = ["NONE"];
    const { answer, proposal } = await ask("ci sono gite in battello");
    expect(followUpRequests).toHaveLength(1);
    expect(proposal).toBeNull();
    expect(answer).toBe("Certo, posso aggiungere una gita in battello: partono vicino al Ponte Carlo.");
  });

  it("makes the change a short yes agrees to", async () => {
    history = [["togliamo il ristorante alla sera", "Certo, posso rimuovere la cena al Restaurace Mlejnice dal Giorno 2."]];
    streamReply = "Perfetto!";
    followUps = [removal({ dayNumber: 2, targetActivityId: "act_m" })];
    const { proposal } = await ask("sì");
    expect(proposal).toMatchObject({ type: "remove", oldActivity: { name: "Restaurace Mlejnice" } });
    expect(followUpRequests[0].contents.at(-1)!.parts[0].text).toContain("agrees to a change offered earlier");
  });

  it("keeps the answer when the follow-up fails", async () => {
    streamReply = "Certo, posso rimuovere la cena al Restaurace Mlejnice dal Giorno 2.";
    followUps = [new Error("503")];
    const { answer, proposal } = await ask("togliamo il ristorante alla sera");
    expect(proposal).toBeNull();
    expect(answer).toBe("Certo, posso rimuovere la cena al Restaurace Mlejnice dal Giorno 2.");
  });

  it("answers a question with one call", async () => {
    streamReply = "Early morning, right at opening, before the tour groups.";
    const { answer, proposal } = await ask("what's the best time to visit the castle?");
    expect(answer).toBe("Early morning, right at opening, before the tour groups.");
    expect(proposal).toBeNull();
    expect(followUpRequests).toHaveLength(0);
  });

  // The trip assistant keeps its threads in the same table.
  it("remembers and stores only concierge turns", async () => {
    streamReply = "Early morning, right at opening.";
    await ask("what's the best time to visit the castle?");
    expect(memoryFilters).toContainEqual(["context->>surface", "concierge_f4"]);
    expect(persisted.at(-1)?.context.surface).toBe("concierge_f4");
  });

  it("names the language the traveller writes in", async () => {
    streamReply = "Ok.";
    const asked = async (question: string) => {
      await ask(question);
      return streamRequests.at(-1)!.contents.at(-1)!.parts[0].text;
    };
    expect(await asked("aereporto di praga bus per il citta vecchia")).toMatch(/Answer in Italian\.$/);
    expect(await asked("what's the best time to visit the castle?")).toMatch(/Answer in English\.$/);
    // A reply of a word or two: their earlier questions, else the trip's.
    history = [["what is on day 2 for the evening?", "A dinner at Restaurace Mlejnice."]];
    expect(await asked("ok")).toMatch(/Answer in English\.$/);
    history = [];
    expect(await asked("ok")).toMatch(/Answer in Italian\.$/);
    // Nothing shows it: the model reads the question.
    expect(await asked("how do I put my hotel in?")).not.toContain("Answer in");
  });

  it("does the same without streaming", async () => {
    streamReply = "Ecco la proposta per rimuovere Restaurace Mlejnice dal Giorno 2.";
    followUps = [removal({ dayNumber: 2, targetActivityId: "act_m" })];
    const { json } = await ask("ok", false);
    expect(json.proposal).toMatchObject({ type: "remove", dayNumber: 2 });
    expect(json.answer).toBe("Ecco la proposta per rimuovere Restaurace Mlejnice dal Giorno 2.");
  });
});
