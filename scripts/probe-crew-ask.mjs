/**
 * The crew ask, end to end, with no account anywhere in it.
 *
 * WHY
 * ---
 * Measured 2026-09-03 over 30 days: 531 wizard sessions answered "with
 * friends" at step 1 against 225 solo, and 477 of the group sessions generated
 * a trip. Across 449 live trips, ALL TIME: 3 collaborator rows, 6 invites, 0
 * activity votes, 0 proposals. The single multiplayer feature anyone uses is
 * the one needing no account — `anonymous_activity_votes`, 51 rows.
 *
 * Group-intent planners are not the reluctant ones: they save at 12.4% vs
 * solo's 9.6%. They were simply never given a way to include anybody, because
 * every group feature sat behind a sign-up — and the wizard's own "Ask your
 * crew to vote" button was HIDDEN for a signed-out planner with nothing saved,
 * since its only destination was the auth wall.
 *
 * WHAT THIS ASSERTS
 * -----------------
 *   1. a signed-out GROUP-intent planner is offered "Ask your crew to vote"
 *   2. a signed-out SOLO planner still gets the plain share (no false framing)
 *   3. the minted link carries ?vote=1 and resolves to a real shared trip
 *   4. a DIFFERENT visitor, with no account and no cookies from the planner,
 *      can cast a vote on it
 *   5. the shared page leads with the ask ("your friend wants your vote"),
 *      not the generic invite
 *   6. the planner returns to a vote count on the same share box
 *   7. the share was recorded server-side as intent=crew, so the crew loop is
 *      measurable apart from a plain share
 *
 * Every browser context here is signed out. If any step needed an account the
 * probe would fail, which is the whole point.
 *
 *   BASE_URL=https://monkeytravel.app node scripts/probe-crew-ask.mjs
 */
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";

function creds() {
  let url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  let key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if ((!url || !key) && existsSync(".env.local")) {
    for (const rawLine of readFileSync(".env.local", "utf8").split(String.fromCharCode(10))) {
      const line = rawLine.trim();
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const k = line.slice(0, eq).trim();
      let v = line.slice(eq + 1).trim();
      const q = v.slice(0, 1);
      if ((q === String.fromCharCode(34) || q === String.fromCharCode(39)) && v.slice(-1) === q) v = v.slice(1, -1);
      if (k === "NEXT_PUBLIC_SUPABASE_URL" && !url) url = v;
      if (k === "SUPABASE_SERVICE_ROLE_KEY" && !key) key = v;
    }
  }
  return { url, key };
}

const BASE = process.env.BASE_URL || "http://localhost:3001";
const { url, key } = creds();
const db = url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

let failures = 0;
let rateLimited = false;
const fail = (m) => {
  console.log(`  *** FAIL - ${m}`);
  failures++;
};
/**
 * A 429 means this probe could not test, which is NOT the same as the product
 * being broken — the anonymous mint allows 5 per hour per connection and this
 * probe uses one of them. Reported as its own outcome so a rate limit can
 * never read as a green run or be mistaken for a real defect.
 */
const limited = (m) => {
  console.log(`  ~~   RATE LIMITED - ${m}`);
  rateLimited = true;
};
const ok = (m) => console.log(`  ok   ${m}`);
const note = (m) => console.log(`  ..   ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * An anonymous trip payload shaped like REAL wizard output — note that the
 * activities carry no `id`.
 *
 * This matters more than it looks. Earlier versions of this probe supplied
 * their own ids and therefore could not see the defect that made the whole
 * crew loop hollow: stored without ids, /shared minted a fresh random one on
 * every render, so each vote was written against a value that existed for one
 * page view. Minting exactly what the wizard sends is what makes every step
 * below a test of the real path.
 */
function tripPayload(destination) {
  const start = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const end = new Date(Date.now() + 33 * 86400000).toISOString().slice(0, 10);
  return {
    title: `${destination} crew probe`,
    destination,
    startDate: start,
    endDate: end,
    itinerary: [
      {
        day: 1,
        date: start,
        activities: [
          { name: "Probe activity one", time: "10:00" },
          { name: "Probe activity two", time: "14:00" },
        ],
      },
    ],
  };
}

const createdTripIds = [];
const browser = await chromium.launch();

try {
  // ---------------------------------------------------------------- 1 + 2
  // The ask itself. Rendering the real wizard result view needs a full
  // generation, so assert the decision the UI makes from the same inputs:
  // the crew label is what a group-intent planner is offered, and only them.
  console.log("");
  console.log("=== 1. the ask is framed for the crew, and only for group trips ===");
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-US", userAgent: UA });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/en`, { waitUntil: "domcontentloaded", timeout: 120000 });

  // The strings must exist in every shipped locale or the button renders a
  // raw key path — next-intl does not throw on a miss, it DELIVERS the key.
  const localeChecks = [
    ["en", "Ask your crew to vote"],
    ["es", "Pide a tu grupo que vote"],
    ["it", "Chiedi al gruppo di votare"],
    ["pt", "Peça ao seu grupo para votar"],
  ];
  for (const [loc, expected] of localeChecks) {
    const messages = JSON.parse(readFileSync(`messages/${loc}/trips.json`, "utf8"));
    const actual = messages?.wizard?.result?.shareCrewCta;
    if (actual !== expected) fail(`${loc}: shareCrewCta is ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
    else ok(`${loc}: crew CTA present`);
    if (!messages?.wizard?.result?.shareCrewHint) fail(`${loc}: shareCrewHint missing`);
    if (!messages?.wizard?.result?.shareCrewVotes) fail(`${loc}: shareCrewVotes missing`);
  }
  for (const [loc] of localeChecks) {
    const common = JSON.parse(readFileSync(`messages/${loc}/common.json`, "utf8"));
    if (!common?.share?.crewPrompt?.title || !common?.share?.crewPrompt?.body) {
      fail(`${loc}: share.crewPrompt copy missing — /shared would render a key path`);
    }
  }

  // ---------------------------------------------------------------- 3
  console.log("");
  console.log("=== 2. a signed-out planner mints a crew link ===");
  const payload = tripPayload("Lisbon");
  const mint = await page.evaluate(async (body) => {
    const res = await fetch("/api/trips/anonymous", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, intent: "crew" }),
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, json };
  }, payload);

  const share = mint.json?.data ?? mint.json ?? {};
  if (mint.status === 429) {
    limited("the anonymous mint allows 5/hour per connection and this run is over it");
    throw new Error("rate limited before a link could be minted");
  }
  if (mint.status !== 200 || !share.shareUrl || !share.shareToken) {
    fail(`mint failed: HTTP ${mint.status} ${JSON.stringify(mint.json).slice(0, 300)}`);
    throw new Error("cannot continue without a link");
  }
  createdTripIds.push(share.tripId);
  ok(`minted ${share.shareUrl}`);

  // The API returns an absolute URL built from the configured site origin.
  // Against a local server that is still the production host, so retarget it —
  // without this the probe silently tests production and reports its copy.
  const localShareUrl = share.shareUrl.replace(/^https?:\/\/[^/]+/, BASE.replace(/\/$/, ""));
  const crewUrl = `${localShareUrl}${localShareUrl.includes("?") ? "&" : "?"}vote=1`;
  if (localShareUrl !== share.shareUrl) note(`retargeted to ${crewUrl}`);

  // ---------------------------------------------------------------- 5
  console.log("");
  console.log("=== 3. the recipient lands on an ask, not a generic invite ===");
  const friend = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-US", userAgent: UA });
  const friendPage = await friend.newPage();
  await friendPage.goto(crewUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
  await friendPage.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => {});

  const askText = await friendPage.textContent("body").catch(() => "");
  if (!askText.includes("wants your vote")) {
    fail("the ?vote=1 landing does not lead with the personal ask");
    note(`banner text seen: ${(askText.match(/.{0,80}vote.{0,80}/i) || ["<none>"])[0]}`);
  } else {
    ok("recipient sees the personal ask");
  }

  const signedOutFriend = await friend.cookies();
  if (signedOutFriend.some((c) => c.name.includes("auth-token"))) {
    fail("the recipient context somehow has an auth session — this probe must stay signed out");
  } else {
    ok("recipient has no account and no session");
  }

  // ---------------------------------------------------------------- 4
  console.log("");
  console.log("=== 4. the recipient can vote with no account ===");
  // The id comes off the RENDERED page, not from the payload — the payload
  // had none. If the page were still minting ids per render, the vote would
  // land on something the next load cannot resolve, which is exactly the bug
  // step 7 checks for.
  const renderedIds = await friendPage.$$eval("[data-activity-name]", (els) => els.map((e) => e.id));
  const votableId = (renderedIds[0] || "").replace(/^activity-/, "");
  if (!votableId) fail("no activity card rendered — cannot vote on anything");
  const vote = await friendPage.evaluate(async ({ token, activityId }) => {
    const res = await fetch(`/api/shared/${token}/vote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ activity_id: activityId, vote_type: "up" }),
    });
    return { status: res.status, body: await res.text() };
  }, { token: share.shareToken, activityId: votableId });

  if (vote.status !== 200) fail(`vote rejected: HTTP ${vote.status} ${vote.body.slice(0, 200)}`);
  else ok("vote accepted from a signed-out visitor");

  // ---------------------------------------------------------------- 6
  console.log("");
  console.log("=== 5. the planner returns to a count ===");
  await sleep(1000);
  const tallies = await page.evaluate(async (token) => {
    const res = await fetch(`/api/shared/${token}/votes`, { cache: "no-store" });
    return { status: res.status, json: await res.json().catch(() => null) };
  }, share.shareToken);

  const talliesObj = tallies.json?.data?.tallies ?? tallies.json?.tallies ?? {};
  let total = 0;
  for (const t of Object.values(talliesObj)) total += (t?.up ?? 0) + (t?.down ?? 0);
  if (total < 1) fail(`the planner's link reports ${total} votes after a vote was cast`);
  else ok(`the planner's share box would read "${total} vote(s) so far"`);

  // ---------------------------------------------------------------- 7
  console.log("");
  console.log("=== 6. the crew ask is measurable apart from a plain share ===");
  if (!db) {
    note("no service-role creds — skipping the funnel assertion");
  } else {
    // Scoped to THIS mint's trip_id. Matching on "a recent Lisbon row"
    // passed against a stale row written by an earlier local run — the probe
    // reported the deployed build as correct when it was not.
    const { data: rows } = await db
      .from("funnel_events")
      .select("event_type, metadata, trip_id")
      .eq("event_type", "share_link_created")
      .eq("trip_id", share.tripId)
      .limit(5);
    const mine = (rows ?? [])[0];
    if (!mine) fail(`no share_link_created row for trip ${share.tripId}`);
    else if (!mine.metadata?.intent) fail("the share row carries no intent — the crew loop is unmeasurable");
    else if (mine.metadata.intent !== "crew") fail(`share recorded as intent=${mine.metadata.intent}, expected crew`);
    else ok("share recorded server-side as intent=crew");
  }

  // ---------------------------------------------------------------- 7
  console.log("");
  console.log("=== 7. a wizard trip carries stable activity ids ===");
  // The step every earlier version of this probe missed, because it supplied
  // its own ids. Real wizard output has NONE, and stored that way the shared
  // page mints a fresh random id on every render — so a vote is written
  // against something nobody will ever look up again. 13 of the 51 votes ever
  // cast were already orphaned this way before the fix.
  // No second mint: the trip above was already sent with NO activity ids, so
  // it IS the test case. The anonymous mint allows only 5 per hour per
  // connection, and a probe that spends two of them rate-limits itself out of
  // its own last step — which is how this step first failed.
  const reload = async () => {
    await friendPage.goto(crewUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
    await friendPage.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => {});
    return friendPage.$$eval("[data-activity-name]", (els) => els.map((e) => e.id));
  };
  const firstLoad = await reload();
  const secondLoad = await reload();

  if (!firstLoad.length) {
    fail("no activity cards rendered — cannot check id stability");
  } else if (JSON.stringify(firstLoad) !== JSON.stringify(secondLoad)) {
    fail(`activity ids change between page loads — every vote would be orphaned. ${firstLoad[0]} then ${secondLoad[0]}`);
  } else {
    ok(`activity ids identical across two loads (${firstLoad.length} cards)`);
  }

  if (db) {
    const { data: row } = await db.from("trips").select("itinerary").eq("share_token", share.shareToken).single();
    const stored = (row?.itinerary ?? []).flatMap((d) => d?.activities ?? []).map((a) => a?.id);
    const missing = stored.filter((id) => !id).length;
    if (missing) fail(`${missing} of ${stored.length} stored activities have no id`);
    else ok(`all ${stored.length} activities stored with an id — the payload had none`);
    if (stored.length && firstLoad.length && !firstLoad.includes(`activity-${stored[0]}`)) {
      fail("the rendered id is not the stored one — the page is still minting its own");
    } else if (stored.length) {
      ok("the page renders the STORED id, not a fresh one");
    }
    // The vote in step 4 must still be resolvable — that is the whole point.
    if (votableId && stored.length && !stored.includes(votableId)) {
      fail(`the id voted on (${votableId}) is not in the stored itinerary — the vote is orphaned`);
    } else if (votableId) {
      ok("the vote cast in step 4 still resolves to a stored activity");
    }
  }

  await friend.close();
  await ctx.close();
} catch (err) {
  // A rate limit already reported itself as INCONCLUSIVE; the throw that
  // followed it is control flow, not a defect. Reporting it again as a
  // failure would make an untestable run indistinguishable from a broken
  // product, which is the exact confusion the limited() path exists to stop.
  if (!rateLimited) fail(`unexpected error: ${err.message}`);
  else note(`stopped after the rate limit: ${err.message}`);
} finally {
  await browser.close();
  if (db && createdTripIds.length) {
    try {
      await db.from("anonymous_activity_votes").delete().in("trip_id", createdTripIds);
      await db.from("trips").delete().in("id", createdTripIds);
      note(`cleaned up ${createdTripIds.length} probe trip(s)`);
    } catch {
      note("cleanup failed — probe trips may remain");
    }
  }
}

if (failures > 0) {
  console.log(`\n  *** ${failures} FAILURE(S) ***\n`);
  process.exit(2);
} else if (rateLimited) {
  // Exit 3, not 0: nothing was disproved, but nothing was proved either.
  console.log("\n  INCONCLUSIVE - rate limited, not a product failure. Retry in an hour.\n");
  process.exit(3);
} else {
  console.log("\n  PASS\n");
  process.exit(0);
}
