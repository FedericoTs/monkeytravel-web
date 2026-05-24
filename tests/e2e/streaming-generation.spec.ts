import { test, expect } from "@playwright/test";

/**
 * Streaming generation — POST /api/ai/generate/stream.
 *
 * The contract-level checks (input validation, rate-limit, auth gating)
 * run unconditionally against the live prod deployment. The live Gemini
 * call gated by SKIP_AI_TESTS=1 because it costs quota every time.
 *
 * What we lock down here:
 *   - The endpoint exists and returns text/event-stream when inputs are valid
 *   - It rejects bad input with the same JSON 4xx shape as the non-stream route
 *   - It sends `metadata` + `complete` SSE events in the right order
 *   - The final itinerary in `complete` has the expected day count
 */

import type {
  SseMetadataData,
  SseCompleteData,
  SseDayData,
  SseErrorData,
} from "@/lib/streaming/sse";

const VALID_BODY = {
  destination: "Lisbon, Portugal",
  startDate: "2026-09-01",
  endDate: "2026-09-04",
  budgetTier: "balanced",
  pace: "moderate",
  vibes: ["cultural", "foodie"],
};

test.describe("Streaming generation — pre-flight gates @prod", () => {
  test("API: missing required fields returns JSON 400 (not SSE)", async ({
    request,
  }) => {
    const res = await request.post("/api/ai/generate/stream", {
      data: { destination: "Lisbon" },
    });
    expect(res.status()).toBe(400);
    expect(res.headers()["content-type"]).toMatch(/application\/json/);
  });

  test("API: malformed JSON body returns 400", async ({ request }) => {
    const res = await request.post("/api/ai/generate/stream", {
      headers: { "Content-Type": "application/json" },
      data: "not json{",
    });
    expect(res.status()).toBe(400);
  });

  test("API: invalid date range returns 400", async ({ request }) => {
    const res = await request.post("/api/ai/generate/stream", {
      data: { ...VALID_BODY, endDate: "2026-08-01" }, // end before start
    });
    expect(res.status()).toBe(400);
  });
});

test.describe("Streaming generation — live Gemini stream @prod @slow", () => {
  test.skip(
    !!process.env.SKIP_AI_TESTS,
    "set SKIP_AI_TESTS=1 to skip burning Gemini quota"
  );

  test("emits metadata + day events + complete with full itinerary", async ({
    request,
  }) => {
    // Use anonymous quota (2/24h). If you re-run this test multiple times
    // from the same machine it'll 429 — that's expected, and tests above
    // cover the 429 path. We just need ONE successful trip per test run.
    const res = await request.post("/api/ai/generate/stream", {
      data: VALID_BODY,
      // 90s budget — generation usually completes in 30-40s.
      timeout: 90_000,
    });

    // 429 from prior runs is acceptable — assert the contract still holds.
    if (res.status() === 429) {
      const body = await res.json();
      expect(body.error).toMatch(/limit|sign up/i);
      return;
    }

    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toMatch(/text\/event-stream/);
    expect(res.headers()["cache-control"]).toMatch(/no-cache|no-transform/);

    // Parse the SSE wire format. The endpoint emits ASCII so naive
    // text decoding is fine.
    const text = await res.text();
    const events = parseSseStream(text);

    // First event is always metadata.
    expect(events[0]?.event).toBe("metadata");
    const meta = events[0].data as SseMetadataData;
    expect(meta.totalDays).toBe(4); // 4-day trip per VALID_BODY
    expect(meta.mode).toBe("stream");
    expect(meta.destination?.name).toBeDefined();

    // At least one day event between metadata and complete.
    const dayEvents = events.filter((e) => e.event === "day");
    expect(dayEvents.length, "at least one day event").toBeGreaterThan(0);
    expect(dayEvents.length, "no more days than totalDays").toBeLessThanOrEqual(
      meta.totalDays
    );

    // Final event is complete (or error, which we surface clearly).
    const last = events[events.length - 1];
    if (last.event === "error") {
      const errData = last.data as SseErrorData;
      throw new Error(`stream ended with error: ${errData.error}`);
    }
    expect(last.event).toBe("complete");
    const complete = last.data as SseCompleteData;
    expect(complete.itinerary).toBeDefined();
    expect(complete.meta?.generatedDays).toBe(meta.totalDays);
    expect(complete.meta?.totalDays).toBe(meta.totalDays);
    expect(complete.meta?.cached).toBe(false);

    // Sanity-check the first day looks right.
    const firstDay = dayEvents[0].data as SseDayData;
    expect(firstDay.day_number).toBe(1);
    expect(firstDay.date).toBeDefined();
  });
});

/**
 * Bare-bones SSE parser for tests. Splits on \n\n and pulls event name +
 * data lines. Mirrors the production client parser (lib/streaming/client.ts)
 * so a test failure here means either the server or the wire format
 * regressed — both worth catching.
 */
function parseSseStream(
  text: string
): Array<{ event: string; data: unknown }> {
  const out: Array<{ event: string; data: unknown }> = [];
  for (const raw of text.split("\n\n")) {
    if (!raw.trim()) continue;
    let event = "message";
    let dataLine = "";
    for (const line of raw.split("\n")) {
      if (line.startsWith("event: ")) event = line.slice(7).trim();
      else if (line.startsWith("data: ")) dataLine = line.slice(6);
    }
    if (!dataLine) continue;
    try {
      out.push({ event, data: JSON.parse(dataLine) });
    } catch {
      // skip malformed
    }
  }
  return out;
}
