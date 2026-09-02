/**
 * The auth callback must tell a FIRST email confirmation apart from a
 * returning magic-link login.
 *
 * Before: both arrived at /trips/new?auth_event=email_confirmed, so the
 * wizard could not know who had just created an account. After: the first
 * confirmation carries auth_event=signup_email; a later magic-link login for
 * the same account still carries email_confirmed.
 *
 * Pure HTTP — mints real token_hashes with the admin API and reads the
 * redirect Location header with redirect:"manual", so nothing downstream
 * (AuthEventTracker strips the param on the client) can hide the answer.
 *
 *   BASE_URL=http://localhost:3001 node scripts/probe-auth-event-marker.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";

function creds() {
  let url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  let key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if ((!url || !key) && existsSync(".env.local")) {
    for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
      if (!m) continue;
      const v = m[2].trim().replace(/^["']|["']$/g, "");
      if (m[1] === "NEXT_PUBLIC_SUPABASE_URL" && !url) url = v;
      if (m[1] === "SUPABASE_SERVICE_ROLE_KEY" && !key) key = v;
    }
  }
  return { url, key };
}

const BASE = process.env.BASE_URL || "http://localhost:3001";
const { url, key } = creds();
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

let failures = 0;
const fail = (m) => { console.log(`  *** FAIL - ${m}`); failures++; };
const ok = (m) => console.log(`  ok   ${m}`);

async function redeem(tokenHash, type, next) {
  const nextParam = next ? `&next=${encodeURIComponent(next)}` : "";
  const target = `${BASE}/auth/callback?token_hash=${encodeURIComponent(tokenHash)}&type=${type}&locale=en${nextParam}`;
  const res = await fetch(target, { redirect: "manual" });
  const loc = res.headers.get("location") || "";
  const u = new URL(loc, BASE);
  return { status: res.status, location: loc, path: u.pathname, authEvent: u.searchParams.get("auth_event") };
}

const email = `mt-probe+marker-${Date.now()}@test.local`;
const password = "Probe!" + Math.random().toString(36).slice(2, 12);
const { data: created, error } = await db.auth.admin.createUser({ email, password, email_confirm: false });
if (error) { console.error("could not create probe user:", error.message); process.exit(1); }

try {
  // Warm the route on a cold dev server so the real request is not a compile.
  await fetch(`${BASE}/auth/callback`, { redirect: "manual" }).catch(() => {});

  console.log("\n=== 1. first email confirmation ===");
  const { data: l1, error: e1 } = await db.auth.admin.generateLink({ type: "signup", email, password });
  if (e1 || !l1?.properties?.hashed_token) fail(`could not mint a signup link: ${e1?.message}`);
  else {
    const r = await redeem(l1.properties.hashed_token, "signup");
    console.log(`     ${r.status} -> ${r.location.replace(BASE, "")}`);
    if (r.authEvent === "signup_email") ok("first confirmation is marked auth_event=signup_email");
    else fail(`first confirmation carried auth_event=${r.authEvent}`);
  }

  console.log("\n=== 2. returning magic-link login for the same account ===");
  const { data: l2, error: e2 } = await db.auth.admin.generateLink({ type: "magiclink", email });
  if (e2 || !l2?.properties?.hashed_token) fail(`could not mint a magic link: ${e2?.message}`);
  else {
    const r = await redeem(l2.properties.hashed_token, "magiclink");
    console.log(`     ${r.status} -> ${r.location.replace(BASE, "")}`);
    if (r.authEvent === "email_confirmed") ok("returning login keeps auth_event=email_confirmed");
    else fail(`returning login carried auth_event=${r.authEvent}`);
  }
  console.log("");
  console.log("=== 3. a first arrival bound for the empty trip list goes to the wizard ===");
  // The regression this now guards (2026-09-02): the login page defaults
  // next=/trips, and until #87 /trips redirected zero-trip users onward. The
  // callback has to make that call itself. This exercises the same helper the
  // Google branch uses; that branch cannot be probed here because it needs a
  // real Google sign-in.
  const email2 = `mt-probe+landing-${Date.now()}@test.local`;
  const { data: created2, error: ce2 } = await db.auth.admin.createUser({ email: email2, password, email_confirm: false });
  if (ce2) fail(`could not create the landing probe user: ${ce2.message}`);
  else {
    try {
      const { data: l3, error: e3 } = await db.auth.admin.generateLink({ type: "signup", email: email2, password });
      if (e3 || !l3?.properties?.hashed_token) fail(`could not mint a signup link: ${e3?.message}`);
      else {
        const r = await redeem(l3.properties.hashed_token, "signup", "/trips");
        console.log(`     ${r.status} -> ${r.location.replace(BASE, "")}`);
        if (r.path.endsWith("/trips/new")) ok("first arrival with next=/trips lands on the wizard");
        else fail(`first arrival with next=/trips landed on ${r.path}`);
        if (r.authEvent === "signup_email") ok("...and still carries auth_event=signup_email");
        else fail(`the landing rewrite changed the marker to ${r.authEvent}`);
      }
      const { data: l4, error: e4 } = await db.auth.admin.generateLink({ type: "magiclink", email: email2 });
      if (e4 || !l4?.properties?.hashed_token) fail(`could not mint a magic link: ${e4?.message}`);
      else {
        const r = await redeem(l4.properties.hashed_token, "magiclink", "/trips");
        console.log(`     ${r.status} -> ${r.location.replace(BASE, "")}`);
        // The email branch rewrites /trips -> /trips/new for EVERYONE (route.ts
        // ~162, "Prefer trips/new for new users"), returning logins included.
        // That predates this probe and is left alone; pinned here so a change
        // to it is deliberate. The first-arrival-only rule added for the OAuth
        // branch lives in lib/auth/first-login.ts and is covered by unit tests,
        // since driving a real Google sign-in here is not possible.
        if (r.path.endsWith("/trips/new")) ok("returning email login also lands on the wizard (long-standing email-branch rule)");
        else fail(`returning email login went to ${r.path}, not the wizard the email branch has always chosen`);
      }
    } finally {
      await db.auth.admin.deleteUser(created2.user.id).catch(() => {});
    }
  }

} finally {
  await db.auth.admin.deleteUser(created.user.id).catch(() => {});
  console.log("\n  probe user deleted");
}

console.log(failures === 0 ? "\n  PASS\n" : `\n  *** ${failures} FAILURE(S) ***\n`);
process.exit(failures === 0 ? 0 : 2);
