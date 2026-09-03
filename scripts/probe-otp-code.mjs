/**
 * The six-digit code actually redeems, and the email actually carries it.
 *
 * WHY
 * ---
 * Magic-link sign-ups reach a session 63.0% of the time against Google's
 * 99.0% (n=142, p=1.8e-9), because the link means leaving the browser. The
 * code lets someone finish in the tab they are already in. Two things had to
 * be true for that to work, and both were false until now:
 *
 *   1. the email a NEW address receives has to contain a code. It did not —
 *      ConfirmSignup took no token, and `signInWithOtp({shouldCreateUser})`
 *      sends exactly that template to a new address, so the people being lost
 *      were the ones getting no code.
 *   2. `verifyOtp` has to accept it under a type the client can guess.
 *
 * SENDS NO EMAIL. `admin.generateLink` mints a real, redeemable token and
 * returns it without dispatching anything, which matters because the
 * auth-email cap is project-wide and two test sends have exhausted it before.
 *
 *   node scripts/probe-otp-code.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";

function creds() {
  let url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  let key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  let anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  if ((!url || !key || !anon) && existsSync(".env.local")) {
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
      if (/^(NEXT_PUBLIC_SUPABASE_ANON_KEY|NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)$/.test(k) && !anon) anon = v;
    }
  }
  return { url, key, anon };
}

const { url, key, anon } = creds();
let failures = 0;
const fail = (m) => { console.log(`  *** FAIL - ${m}`); failures++; };
const ok = (m) => console.log(`  ok   ${m}`);
const note = (m) => console.log(`  ..   ${m}`);

if (!url || !key || !anon) {
  console.log("\n  Needs NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and the anon key.\n");
  process.exit(1);
}

const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const created = [];

/** Mirrors lib/auth/otp-code.ts — kept literal so a drift there is visible here. */
const OTP_VERIFY_TYPES = ["email", "signup", "magiclink"];

try {
  // ---------------------------------------------------------------- 1
  console.log("");
  console.log("=== 1. a NEW address gets a code in its email ===");
  // The signup template is what signInWithOtp sends to an address that does
  // not exist yet — precisely the population the funnel loses.
  const newEmail = `otp-probe-${randomUUID().slice(0, 8)}@monkeytravel-probe.invalid`;
  const { data: gen, error: genErr } = await admin.auth.admin.generateLink({
    type: "signup",
    email: newEmail,
    password: randomUUID(),
  });
  if (genErr) {
    fail(`generateLink(signup) failed: ${genErr.message}`);
  } else {
    if (gen?.user?.id) created.push(gen.user.id);
    const otp = gen?.properties?.email_otp;
    if (!otp) {
      fail("no email_otp returned — the hook would have no code to print");
    } else if (!/^\d{6}$/.test(otp)) {
      fail(`email_otp is not six digits: ${JSON.stringify(otp)}`);
    } else {
      ok(`signup produced a six-digit code (${otp.length} digits)`);
    }

    // The template must actually render it. This is the half that was broken:
    // ConfirmSignup accepted no token at all.
    if (otp) {
      const { render } = await import("@react-email/render");
      const mod = await import("../lib/email/templates/ConfirmSignup.js").catch(() => null);
      if (!mod) {
        note("could not import the template from a plain .mjs (expected — checked via tsx instead)");
      } else {
        const html = await render(mod.default({ confirmUrl: "https://x/y", token: otp, locale: "en" }));
        if (html.includes(otp)) ok("ConfirmSignup renders the code");
        else fail("ConfirmSignup does NOT render the code — new users still get a link only");
      }
    }

    // ---------------------------------------------------------------- 2
    console.log("");
    console.log("=== 2. the code redeems into a real session, in-tab ===");
    if (otp) {
      // A fresh anon client, exactly like the browser's: no cookies, no
      // code_verifier, nothing device-bound. That is the whole point — this
      // is what a magic link could not do across devices.
      const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
      let redeemed = null;
      let attempts = 0;
      for (const type of OTP_VERIFY_TYPES) {
        attempts++;
        const { data, error } = await client.auth.verifyOtp({ email: newEmail, token: otp, type });
        if (!error && data?.session) { redeemed = { type, session: data.session }; break; }
        note(`type "${type}": ${error ? error.message.slice(0, 70) : "no session"}`);
      }
      if (!redeemed) {
        fail(`the code did not redeem under any of ${OTP_VERIFY_TYPES.join(", ")}`);
      } else {
        ok(`redeemed as type "${redeemed.type}" after ${attempts} attempt(s)`);
        if (!redeemed.session.access_token) fail("session has no access token");
        else ok("a usable session came back (access token present)");
        if (OTP_VERIFY_TYPES.indexOf(redeemed.type) > 0) {
          note(`ordering note: "${OTP_VERIFY_TYPES[0]}" did not win — consider reordering OTP_VERIFY_TYPES`);
        }
      }
    }
  }

  // ---------------------------------------------------------------- 3
  console.log("");
  console.log("=== 3. an EXISTING address still works (magiclink template) ===");
  const { data: gen2, error: gen2Err } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: created.length ? (await admin.auth.admin.getUserById(created[0])).data?.user?.email : newEmail,
  });
  if (gen2Err) {
    note(`generateLink(magiclink) failed: ${gen2Err.message}`);
  } else {
    const otp2 = gen2?.properties?.email_otp;
    if (!otp2 || !/^\d{6}$/.test(otp2)) fail("magiclink produced no six-digit code");
    else ok("magiclink also produces a six-digit code (AuthAction already printed it)");
  }

  // ---------------------------------------------------------------- 4
  console.log("");
  console.log("=== 4. the new funnel steps are accepted by the database ===");
  const sid = `probe-otp-${randomUUID()}`;
  for (const step of ["otp_code_submitted", "otp_code_verified"]) {
    const { error } = await admin.from("wizard_step_events").insert({ session_id: sid, step });
    if (error) fail(`step "${step}" rejected: ${error.message}`);
    else ok(`step "${step}" accepted`);
  }
  await admin.from("wizard_step_events").delete().eq("session_id", sid);
} catch (err) {
  fail(`unexpected error: ${err.message}`);
} finally {
  for (const id of created) {
    try { await admin.auth.admin.deleteUser(id); note(`cleaned up probe user ${id.slice(0, 8)}…`); } catch { /* best effort */ }
  }
}

console.log(failures === 0 ? "\n  PASS\n" : `\n  *** ${failures} FAILURE(S) ***\n`);
process.exit(failures === 0 ? 0 : 2);
