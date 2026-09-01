import { test, expect, request as pwRequest } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";

/**
 * trips lockdown — the blanket share_token read must stay closed.
 *
 * WHAT WAS WRONG
 * --------------
 * `trips_select_consolidated` carried a bare `OR (share_token IS NOT NULL)`
 * with nothing comparing a caller-supplied token, so every row that merely HAD
 * a share_token was readable by anyone holding the anon key — which ships in
 * the browser bundle and is public by design.
 *
 * Measured 2026-09-01 as role anon, before the fix:
 *   118 trips readable, 42 of them visibility='private', 39 exposing a live
 *   claim_token, across 51 real users. `select=*` returned full itinerary,
 *   notes, budget and emergency_contacts.
 *
 * claim_token is the worse half: /api/trips/claim needs only any authenticated
 * session plus the token string to transfer ownership permanently.
 *
 * WHY THIS SPEC ASSERTS ON DATA, NOT STATUS
 * -----------------------------------------
 * RLS never errors — it returns fewer rows. Both the broken and the fixed world
 * answer 200. Only the CONTENT distinguishes them, so every assertion here is
 * about which rows and which columns actually came back.
 *
 * THE SECOND HALF MATTERS AS MUCH AS THE FIRST
 * --------------------------------------------
 * Closing the hole must not break the anonymous-share loop, which deliberately
 * stores those trips as visibility='private' and relies on holding the token.
 * So this mints a real anonymous trip and asserts its share page still renders.
 * A fix that passes the lockdown half and fails this one is a regression, not a
 * fix.
 *
 * Run:
 *   BASE_URL=https://monkeytravel.app npx playwright test trips-share-token-lockdown
 */

function anonCreds() {
  let url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  let key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  if ((!url || !key) && existsSync(".env.local")) {
    for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
      if (!m) continue;
      const v = m[2].trim().replace(/^["']|["']$/g, "");
      if (m[1] === "NEXT_PUBLIC_SUPABASE_URL" && !url) url = v;
      if (m[1] === "NEXT_PUBLIC_SUPABASE_ANON_KEY" && !key) key = v;
    }
  }
  return { url, key };
}

test.describe("trips share_token lockdown — anonymous @prod", () => {
  test("anon cannot read a single private trip", async () => {
    const { url, key } = anonCreds();
    test.skip(!url || !key, "anon credentials unavailable");

    const api = await pwRequest.newContext({
      extraHTTPHeaders: { apikey: key, Authorization: `Bearer ${key}` },
    });
    const res = await api.get(
      `${url}/rest/v1/trips?select=id,visibility&visibility=eq.private`
    );
    expect(res.status(), "PostgREST should answer normally").toBe(200);
    const rows = (await res.json()) as Array<{ id: string; visibility: string }>;

    // 42 before the fix.
    expect(
      rows.length,
      `anon can read ${rows.length} private trip(s) — the blanket ` +
        "share_token clause is back in trips_select_consolidated"
    ).toBe(0);
    await api.dispose();
  });

  test("anon cannot harvest a single claim_token", async () => {
    const { url, key } = anonCreds();
    test.skip(!url || !key, "anon credentials unavailable");

    const api = await pwRequest.newContext({
      extraHTTPHeaders: { apikey: key, Authorization: `Bearer ${key}` },
    });
    const res = await api.get(
      `${url}/rest/v1/trips?select=id,claim_token&claim_token=not.is.null`
    );
    expect(res.status()).toBe(200);
    const rows = (await res.json()) as Array<{ claim_token: string | null }>;
    const leaked = rows.filter((r) => r.claim_token);

    // 39 before the fix. Each one is a takeover of somebody's unclaimed trip.
    expect(
      leaked.length,
      `${leaked.length} claim_token(s) are readable by anon — any account ` +
        "could claim those trips permanently"
    ).toBe(0);
    await api.dispose();
  });

  test("every trip anon CAN read is deliberately public", async () => {
    const { url, key } = anonCreds();
    test.skip(!url || !key, "anon credentials unavailable");

    const api = await pwRequest.newContext({
      extraHTTPHeaders: { apikey: key, Authorization: `Bearer ${key}` },
    });
    const res = await api.get(
      `${url}/rest/v1/trips?select=id,visibility,is_hidden,is_template&limit=200`
    );
    expect(res.status()).toBe(200);
    const rows = (await res.json()) as Array<{
      visibility: string;
      is_hidden: boolean | null;
      is_template: boolean | null;
    }>;

    // The Explore feed must keep working, so this is not "zero rows" — it is
    // "every row is public". 50 at the time of the fix.
    const notPublic = rows.filter(
      (r) => !(r.visibility === "public" && r.is_hidden !== true)
    );
    expect(
      notPublic.length,
      `${notPublic.length} non-public trip(s) leaked into the anon-readable set`
    ).toBe(0);
    await api.dispose();
  });
});

test.describe("the anonymous share loop still works @prod", () => {
  test("a freshly minted private share link still renders its trip", async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);

    // Mint a real anonymous trip the way the product does. It is stored
    // visibility='private' on purpose — this is exactly the row the lockdown
    // above makes unreadable through RLS, so if the share page has not been
    // switched to a service-role read keyed on the token, this test fails.
    const created = await request.post("/api/trips/anonymous", {
      data: {
        title: "E2E share lockdown probe",
        destination: "Lisbon",
        startDate: "2026-11-02",
        endDate: "2026-11-04",
        // itinerary is a bare ARRAY of days here, not { days: [...] } —
        // validateAnonymousTripPayload rejects the wrapped form with a 400.
        itinerary: [
          {
            day: 1,
            date: "2026-11-02",
            theme: "Probe",
            activities: [
              { id: "probe-1", name: "Probe activity", time: "10:00" },
            ],
          },
        ],
      },
    });

    test.skip(
      created.status() === 429,
      "anonymous-trip rate limit hit (5/hr/IP) — rerun later"
    );
    expect(
      created.ok(),
      `could not mint an anonymous trip: ${created.status()}`
    ).toBeTruthy();

    // apiSuccess may or may not wrap the payload — accept either shape.
    const raw = (await created.json()) as Record<string, unknown> & {
      data?: Record<string, unknown>;
    };
    const payload = (raw.data ?? raw) as { shareToken?: string };
    const token = payload.shareToken ?? null;
    expect(token, "anonymous trip response carried no share token").toBeTruthy();

    const res = await page.goto(`/shared/${token}`, {
      waitUntil: "domcontentloaded",
    });
    expect(res?.status(), "the share page must not 404").toBe(200);

    // Assert on CONTENT: a 200 that renders "Trip Not Found" would pass a
    // status check and still mean the share loop is broken.
    const text = await page.locator("body").innerText();
    expect(text).not.toMatch(/trip not found/i);
    expect(text).toMatch(/Lisbon/i);
  });
});
