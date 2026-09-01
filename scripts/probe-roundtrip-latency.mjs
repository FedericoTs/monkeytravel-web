/**
 * Do the round-trip reductions still return the same data, and are they faster?
 *
 * WHY THIS EXISTS
 * ---------------
 * Supabase is in us-west-1 while Vercel functions run in iad1. A single
 * trivial round trip measured 118ms median from production (27ms from a
 * co-located preview, so ~91ms of it is pure distance). Several authed pages
 * awaited independent queries one after another, paying that toll per query.
 *
 * Collapsing them is only safe if the responses are byte-identical, and one of
 * the changes touches an AUTHORIZATION decision: /api/trips/[id]/collaborators
 * used to run a dedicated "am I a collaborator?" probe, and now derives it from
 * the collaborator list. That is sound only because RLS on trip_collaborators
 * is owner-or-collaborator-or-own-row, so a non-member's list comes back empty.
 * This probe proves that with a real non-member request rather than trusting
 * the reasoning.
 *
 * Run against a dev server with the e2e fixtures logged in:
 *   npx tsx scripts/e2e-fixtures.mts --seed
 *   BASE_URL=http://localhost:3001 npx tsx scripts/e2e-login.mts
 *   BASE_URL=http://localhost:3001 node scripts/probe-roundtrip-latency.mjs
 */
import { chromium } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:3001";
const FIXTURE_TRIP = process.env.FIXTURE_TRIP || "36cff32b-9c3b-423f-bd29-dd5f223e443e";
// A trip no fixture user owns or collaborates on - the denial case.
const FOREIGN_TRIP = process.env.FOREIGN_TRIP || "148ec590-af5f-4467-ab47-52bbdc67c528";
const SAMPLES = Number(process.env.SAMPLES || 5);

for (const f of [".auth/owner.json", ".auth/mate.json"]) {
  if (!existsSync(f)) {
    console.error(`missing ${f} - run e2e-fixtures --seed then e2e-login first`);
    process.exit(1);
  }
}

const browser = await chromium.launch();
let failures = 0;
const fail = (m) => { console.log(`  *** FAIL - ${m}`); failures++; };
const ok = (m) => console.log(`  ok   ${m}`);

async function ctx(state) {
  return browser.newContext({ storageState: state });
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

// ---------------------------------------------------------------- correctness
console.log("\n=== correctness: collaborators route ===");

const ownerCtx = await ctx(".auth/owner.json");
const ownerPage = await ownerCtx.newPage();
// evaluate() runs in the page's origin. On about:blank the fetch below is
// cross-origin and fails outright, so land on the app first.
await ownerPage.goto(`${BASE}/trips`, { waitUntil: "domcontentloaded" });

const asOwner = await ownerPage.evaluate(async (url) => {
  const r = await fetch(url);
  return { status: r.status, body: await r.json().catch(() => null) };
}, `/api/trips/${FIXTURE_TRIP}/collaborators`);

if (asOwner.status !== 200) fail(`owner got HTTP ${asOwner.status} on own trip`);
else {
  const list = asOwner.body?.collaborators ?? asOwner.body?.data?.collaborators ?? [];
  const role = asOwner.body?.currentUserRole ?? asOwner.body?.data?.currentUserRole;
  if (list.length < 3) fail(`owner sees ${list.length} collaborators, fixture seeded 3`);
  else ok(`owner sees ${list.length} collaborators`);
  if (role !== "owner") fail(`owner currentUserRole = ${JSON.stringify(role)}, expected "owner"`);
  else ok(`owner currentUserRole = "owner"`);
  const named = list.filter((c) => c.display_name && c.display_name !== "Unknown User").length;
  if (named === 0 && list.length > 0) fail("every collaborator resolved to Unknown User - profile join broke");
  else ok(`${named}/${list.length} collaborators have real display names`);
}

const mateCtx = await ctx(".auth/mate.json");
const matePage = await mateCtx.newPage();
await matePage.goto(`${BASE}/trips`, { waitUntil: "domcontentloaded" });
const asMate = await matePage.evaluate(async (url) => {
  const r = await fetch(url);
  return { status: r.status, body: await r.json().catch(() => null) };
}, `/api/trips/${FIXTURE_TRIP}/collaborators`);

if (asMate.status !== 200) fail(`collaborator got HTTP ${asMate.status} on a trip they are on`);
else {
  const role = asMate.body?.currentUserRole ?? asMate.body?.data?.currentUserRole;
  if (role !== "collaborator") fail(`collaborator currentUserRole = ${JSON.stringify(role)}, expected "collaborator"`);
  else ok(`collaborator currentUserRole = "collaborator"`);
}

// THE ONE THAT MATTERS: the dropped membership probe must not have opened a hole.
const asIntruder = await ownerPage.evaluate(async (url) => {
  const r = await fetch(url);
  return { status: r.status, body: await r.json().catch(() => null) };
}, `/api/trips/${FOREIGN_TRIP}/collaborators`);

if (asIntruder.status === 200) {
  const list = asIntruder.body?.collaborators ?? asIntruder.body?.data?.collaborators ?? [];
  fail(`NON-MEMBER GOT HTTP 200 with ${list.length} collaborators - authorization regression`);
} else {
  ok(`non-member denied on someone else's trip (HTTP ${asIntruder.status})`);
}

// ------------------------------------------------------------------- latency
console.log("\n=== latency: authed pages (server render) ===");

for (const path of ["/trips", "/profile", `/trips/${FIXTURE_TRIP}`]) {
  // Warm the route first. A dev server compiles on first hit (measured 12-22s
  // on the first sample vs ~4s after), which would swamp the signal entirely.
  await ownerPage.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
  await ownerPage.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
  const times = [];
  for (let i = 0; i < SAMPLES; i++) {
    const t0 = Date.now();
    const resp = await ownerPage.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
    times.push(Date.now() - t0);
    if (resp && resp.status() >= 400) fail(`${path} returned HTTP ${resp.status()}`);
  }
  console.log(`  ${path.padEnd(46)} median=${String(median(times)).padStart(5)}ms  (${times.join(", ")})`);
}

// Did the pages actually render their content, not an error boundary?
console.log("\n=== render sanity ===");
await ownerPage.goto(`${BASE}/trips`, { waitUntil: "domcontentloaded" });
const tripsText = await ownerPage.locator("body").innerText().catch(() => "");
if (/error|something went wrong/i.test(tripsText.slice(0, 400))) fail("/trips shows an error");
else ok(`/trips rendered (${tripsText.length} chars)`);

await ownerPage.goto(`${BASE}/profile`, { waitUntil: "domcontentloaded" });
const profText = await ownerPage.locator("body").innerText().catch(() => "");
if (/error|something went wrong/i.test(profText.slice(0, 400))) fail("/profile shows an error");
else ok(`/profile rendered (${profText.length} chars)`);
// The profile page reads display_name out of the parallelised query group.
if (!/e2e|owner|traveler/i.test(profText)) fail("/profile does not show the fixture user's identity");
else ok("/profile shows the signed-in user's identity");

await browser.close();
console.log(failures === 0 ? "\n  PASS\n" : `\n  *** ${failures} FAILURE(S) ***\n`);
process.exit(failures === 0 ? 0 : 2);
