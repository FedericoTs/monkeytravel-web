/**
 * Middleware stopped verifying the session over the network. Prove that did
 * not break authentication, session longevity, or the admin gate.
 *
 * WHAT CHANGED
 * ------------
 * lib/supabase/middleware.ts called supabase.auth.getUser() on every request —
 * a round trip to Supabase Auth in us-west-1 from functions in iad1, measured
 * at ~138ms. Every page that needs identity then called getUser() AGAIN, so a
 * signed-in request verified the same session twice, serially. Middleware now
 * uses getSession(), which reads the session locally, and only /admin still
 * verifies over the network.
 *
 * THE THREE THINGS THAT COULD GO WRONG, and the tests for them:
 *
 * 1. AUTHENTICATION IS WEAKER. getSession() returns a session decoded from the
 *    cookie WITHOUT verifying its signature. If a page trusted middleware's
 *    decision, a forged cookie would now walk straight in. Test: forge a
 *    structurally valid session cookie with a bogus signature and a future
 *    expiry, and assert it still cannot reach signed-in content.
 *
 * 2. SESSIONS SILENTLY DIE. That getUser() call was also the refresh
 *    mechanism — auth-js rotates the token inside a 90s expiry margin and the
 *    ssr cookie handler writes it back. If getSession() did not refresh, every
 *    session would end at token expiry, which is the kind of bug that only
 *    shows up an hour later in production. Test: expire a REAL session's
 *    access token, keep its real refresh token, and assert the request both
 *    succeeds and rotates the cookie.
 *
 * 3. THE ADMIN GATE OPENS. isAdmin() reads user.email to make an
 *    authorization decision, so that branch must still verify. Test: a
 *    signed-in NON-admin must not reach /admin.
 *
 *   npx tsx scripts/e2e-fixtures.mts --seed
 *   BASE_URL=http://localhost:3001 npx tsx scripts/e2e-login.mts
 *   BASE_URL=http://localhost:3001 node scripts/probe-single-auth-verification.mjs
 */
import { chromium } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:3001";
const SAMPLES = Number(process.env.SAMPLES || 6);
const ORIGIN = new URL(BASE).origin;

if (!existsSync(".auth/owner.json")) {
  console.error("missing .auth/owner.json - run e2e-fixtures --seed then e2e-login");
  process.exit(1);
}

const browser = await chromium.launch();
let failures = 0;
const fail = (m) => { console.log(`  *** FAIL - ${m}`); failures++; };
const ok = (m) => console.log(`  ok   ${m}`);
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

const ownerState = JSON.parse(readFileSync(".auth/owner.json", "utf8"));
const authCookies = ownerState.cookies.filter((c) => /^sb-.*-auth-token/.test(c.name));
if (authCookies.length === 0) {
  console.error("no sb-*-auth-token cookie in the saved state");
  process.exit(1);
}

// ------------------------------------------------- 0. baseline: it still works
console.log("\n=== 1. a real session still works ===");
const okCtx = await browser.newContext({ storageState: ".auth/owner.json" });
const okPage = await okCtx.newPage();
let resp = await okPage.goto(`${BASE}/trips`, { waitUntil: "domcontentloaded" });
if (!okPage.url().includes("/trips") || okPage.url().includes("/auth/login")) {
  fail(`signed-in user was bounced off /trips -> ${okPage.url()}`);
} else ok(`signed-in user reaches /trips (HTTP ${resp?.status()})`);

await okPage.goto(`${BASE}/profile`, { waitUntil: "domcontentloaded" });
const profText = await okPage.locator("body").innerText().catch(() => "");
if (okPage.url().includes("/auth/login")) fail("signed-in user bounced off /profile");
else if (!/e2e|owner|traveler/i.test(profText)) fail("/profile does not show the signed-in identity");
else ok("/profile renders the signed-in identity");

// -------------------------------------- 1. a FORGED cookie must not get in
console.log("\n=== 2. a forged session cookie must NOT reach signed-in content ===");
function forgedCookieValue() {
  const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const jwt = `${b64u({ alg: "HS256", typ: "JWT" })}.${b64u({
    sub: "00000000-0000-0000-0000-000000000000",
    aud: "authenticated",
    role: "authenticated",
    email: "attacker@example.com",
    exp: Math.floor(Date.now() / 1000) + 3600,
  })}.${Buffer.from("not-a-real-signature").toString("base64url")}`;
  const session = {
    access_token: jwt,
    refresh_token: "forged",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    expires_in: 3600,
    token_type: "bearer",
    user: {
      id: "00000000-0000-0000-0000-000000000000",
      aud: "authenticated",
      role: "authenticated",
      email: "attacker@example.com",
    },
  };
  return "base64-" + Buffer.from(JSON.stringify(session)).toString("base64");
}

const forgedCtx = await browser.newContext();
await forgedCtx.addCookies([
  {
    name: authCookies[0].name,
    value: forgedCookieValue(),
    domain: new URL(BASE).hostname,
    path: "/",
    httpOnly: false,
    secure: false,
    sameSite: "Lax",
  },
]);
const forgedPage = await forgedCtx.newPage();
await forgedPage.goto(`${BASE}/trips`, { waitUntil: "domcontentloaded" });
const forgedUrl = forgedPage.url();
const forgedText = await forgedPage.locator("body").innerText().catch(() => "");
if (!forgedUrl.includes("/auth/login")) {
  fail(`FORGED COOKIE REACHED ${forgedUrl} instead of /auth/login — auth regression`);
  console.log("      page said:", forgedText.slice(0, 160).replace(/\n/g, " "));
} else {
  ok(`forged cookie bounced to /auth/login (page-level getUser rejected it)`);
}

// ---------------------------------- 2. an EXPIRED access token must refresh
console.log("\n=== 3. an expired access token must still REFRESH (session longevity) ===");
// Rebuild the real session with expires_at in the past, keeping the REAL
// refresh token. auth-js should call _callRefreshToken and rotate the cookie.
function expiredButRefreshable(cookieValue) {
  const raw = cookieValue.startsWith("base64-")
    ? Buffer.from(cookieValue.slice("base64-".length), "base64").toString("utf8")
    : decodeURIComponent(cookieValue);
  const session = JSON.parse(raw);
  session.expires_at = Math.floor(Date.now() / 1000) - 60; // already expired
  session.expires_in = 0;
  return "base64-" + Buffer.from(JSON.stringify(session)).toString("base64");
}

let refreshTested = false;
if (authCookies.length > 1) {
  console.log(`  (session cookie is chunked into ${authCookies.length} parts - skipping rewrite)`);
} else {
  let stale;
  try {
    stale = expiredButRefreshable(authCookies[0].value);
  } catch (e) {
    console.log(`  (could not rewrite the session cookie: ${e.message})`);
  }
  if (stale) {
    refreshTested = true;
    const refreshCtx = await browser.newContext();
    await refreshCtx.addCookies([
      { ...authCookies[0], value: stale, domain: new URL(BASE).hostname, path: "/" },
    ]);
    const rPage = await refreshCtx.newPage();
    await rPage.goto(`${BASE}/trips`, { waitUntil: "domcontentloaded" });
    const stillIn = !rPage.url().includes("/auth/login");
    const after = (await refreshCtx.cookies(ORIGIN)).find((c) => c.name === authCookies[0].name);
    const rotated = after && after.value !== stale;
    if (!stillIn) fail("an expired-but-refreshable session was logged out - refresh is broken");
    else ok("expired access token still reaches /trips (refresh happened)");
    if (!rotated) fail("the auth cookie was NOT rotated - the refreshed token is not being persisted");
    else ok("auth cookie was rotated with the refreshed token");
  }
}
if (!refreshTested) console.log("  *** refresh path NOT exercised - do not claim it works");

// ------------------------------------------- 3. the admin gate must hold
console.log("\n=== 4. a signed-in NON-admin must not reach /admin ===");
const adminPage = await okCtx.newPage();
await adminPage.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded" });
const adminUrl = adminPage.url();
if (/\/admin(\/|$|\?)/.test(new URL(adminUrl).pathname)) {
  const txt = await adminPage.locator("body").innerText().catch(() => "");
  fail(`non-admin stayed on ${adminUrl} — admin gate regression`);
  console.log("      page said:", txt.slice(0, 160).replace(/\n/g, " "));
} else {
  ok(`non-admin redirected off /admin -> ${new URL(adminUrl).pathname}`);
}

// --------------------------------------------------------------- 4. latency
console.log("\n=== 5. latency (signed-in, warmed) ===");
for (const path of ["/trips", "/profile"]) {
  await okPage.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
  await okPage.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
  const times = [];
  for (let i = 0; i < SAMPLES; i++) {
    const t0 = Date.now();
    await okPage.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
    times.push(Date.now() - t0);
  }
  console.log(`  ${path.padEnd(12)} median=${String(median(times)).padStart(5)}ms  (${times.join(", ")})`);
}

await browser.close();
console.log(failures === 0 ? "\n  PASS\n" : `\n  *** ${failures} FAILURE(S) ***\n`);
process.exit(failures === 0 ? 0 : 2);
