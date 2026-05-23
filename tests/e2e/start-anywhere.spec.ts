import { test, expect } from "@playwright/test";

/**
 * "Start Anywhere" — POST /api/ai/extract-trip-context.
 *
 * Reads the input validation paths against the live deployment and
 * (gated behind SKIP_AI_TESTS) hits the real Gemini Vision call with a
 * famous-landmark URL to confirm a successful extraction.
 */

test.describe("Start Anywhere — extract-trip-context @prod", () => {
  test("API: missing all input returns 400", async ({ request }) => {
    const res = await request.post("/api/ai/extract-trip-context", { data: {} });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/imageUrl|imageBase64|websiteText|required/i);
  });

  test("API: malformed JSON body returns 400", async ({ request }) => {
    const res = await request.post("/api/ai/extract-trip-context", {
      headers: { "Content-Type": "application/json" },
      data: "not json{",
    });
    expect(res.status()).toBe(400);
  });

  test("API: oversize imageBase64 is rejected (not processed)", async ({
    request,
  }) => {
    // 7.1MB of A's — over the app-level 7MB cap AND over Vercel's 4.5MB
    // serverless body limit. Either layer can reject; what matters is the
    // request doesn't reach Gemini Vision. Accept any non-2xx that's not a
    // hard infra failure.
    const huge = "A".repeat(7_100_000);
    const res = await request.post("/api/ai/extract-trip-context", {
      data: { imageBase64: huge },
    });
    expect(
      [400, 413, 500, 503],
      `expected reject, got ${res.status()}`
    ).toContain(res.status());
  });

  test("API: data: URL in imageUrl is rejected (must use imageBase64)", async ({
    request,
  }) => {
    const res = await request.post("/api/ai/extract-trip-context", {
      data: { imageUrl: "data:image/png;base64,aGVsbG8=" },
    });
    // Either 503 (from extractTripContext throw) or 500 — both prove the route rejected.
    expect([500, 503]).toContain(res.status());
  });
});

test.describe("Start Anywhere — live Gemini Vision @prod @slow", () => {
  test.skip(
    !!process.env.SKIP_AI_TESTS,
    "set SKIP_AI_TESTS=1 to skip burning Gemini quota"
  );

  test("API: real image URL extracts a destination", async ({ request }) => {
    // Iconic, unambiguous landmark — Eiffel Tower, Wikipedia hosting URL.
    const res = await request.post("/api/ai/extract-trip-context", {
      data: {
        imageUrl:
          "https://upload.wikimedia.org/wikipedia/commons/thumb/8/85/Tour_Eiffel_Wikimedia_Commons_(cropped).jpg/800px-Tour_Eiffel_Wikimedia_Commons_(cropped).jpg",
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.context).toBeDefined();
    expect(body.context.destination?.toLowerCase()).toMatch(/paris|france/);
    expect(body.context.destinationConfidence).toBeGreaterThan(0.6);
    expect(Array.isArray(body.context.vibes)).toBe(true);
    expect(body.context.suggestedDurationDays).toBeGreaterThanOrEqual(2);
    expect(body.context.suggestedDurationDays).toBeLessThanOrEqual(14);
  });

  test("API: websiteText alone (no image) also works", async ({ request }) => {
    const res = await request.post("/api/ai/extract-trip-context", {
      data: {
        websiteText:
          "Five days in Tokyo — cherry blossoms peak around early April, ramen shops in Shinjuku, day trips to Mt. Fuji. Best for foodies and culture-lovers.",
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.context.destination?.toLowerCase()).toMatch(/tokyo|japan/);
    expect(body.context.monthHint?.toLowerCase()).toMatch(/april|march/);
  });
});

test.describe("Start Anywhere — anonymous voting on /shared @prod", () => {
  // Now that the migration is applied, the API surface should be alive.
  // Smoke-check the public path even without a real share token.

  test("GET /api/shared/<invalid>/votes returns 404 (not 500)", async ({
    request,
  }) => {
    const res = await request.get(
      "/api/shared/00000000-0000-0000-0000-000000000000/votes"
    );
    expect(res.status()).toBe(404);
  });

  test("POST /api/shared/<invalid>/vote returns 404 (not 500)", async ({
    request,
  }) => {
    const res = await request.post(
      "/api/shared/00000000-0000-0000-0000-000000000000/vote",
      {
        data: { activity_id: "smoke-test", vote_type: "up" },
      }
    );
    expect(res.status()).toBe(404);
  });
});
