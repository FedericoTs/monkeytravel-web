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

async function redeem(tokenHash, type) {
  const target = `${BASE}/auth/callback?token_hash=${encodeURIComponent(tokenHash)}&type=${type}&locale=en`;
  const res = await fetch(target, { redirect: "manual" });
  const loc = res.headers.get("location") || "";
  return { status: res.status, location: loc, authEvent: new URL(loc, BASE).searchParams.get("auth_event") };
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
} finally {
  await db.auth.admin.deleteUser(created.user.id).catch(() => {});
  console.log("\n  probe user deleted");
}

console.log(failures === 0 ? "\n  PASS\n" : `\n  *** ${failures} FAILURE(S) ***\n`);
process.exit(failures === 0 ? 0 : 2);
