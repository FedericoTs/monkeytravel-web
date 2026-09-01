/**
 * Does an email confirmation link work when opened on a DIFFERENT device?
 *
 * WHY
 * ---
 * Measured 2026-09-01: of 95 users who signed up since 2026-07-01 and never
 * created a trip, 41 have no authenticated page views at all. 40 of those 41
 * had `user_confirmation_requested`, 21 have `email_confirmed_at` SET, and only
 * 4 ever produced a `login` event. Twenty users therefore clicked the
 * confirmation link — Supabase would not have stamped email_confirmed_at
 * otherwise — and still never got a session.
 *
 * The suspected mechanism is PKCE. lib/supabase/client.ts uses
 * createBrowserClient from @supabase/ssr, whose confirmation links carry a
 * `?code=` that can only be exchanged using a `code_verifier` stored in the
 * browser that STARTED the signup. Open that email on your phone and the
 * verifier is not there: Supabase confirms the address server-side, the
 * exchange fails, and /auth/callback redirects to
 * /auth/login?error=Could not authenticate.
 *
 * This script creates a throwaway user, mints a real confirmation link, and
 * prints it. tests/e2e/signup-confirmation-cross-device.spec.ts then opens it
 * in a FRESH browser context — no verifier cookie — which is exactly the
 * phone-opens-the-laptop's-email case.
 *
 *   npx tsx scripts/probe-signup-confirmation.mts --create
 *   npx tsx scripts/probe-signup-confirmation.mts --cleanup
 *
 * Creates ONE throwaway account in production. Always run --cleanup.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync, writeFileSync } from "node:fs";

const OUT = ".auth/signup-probe.json";
const EMAIL = "mt-probe+signup-confirm@test.local";

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
  if (!url || !key) throw new Error("Supabase service credentials not found");
  return { url, key };
}

const { url, key } = creds();
const db = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function findUser() {
  const { data } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
  return data?.users?.find((u) => u.email === EMAIL) ?? null;
}

async function cleanup() {
  const u = await findUser();
  if (!u) {
    console.log(`  ${EMAIL} already absent`);
    return;
  }
  const { error } = await db.auth.admin.deleteUser(u.id);
  console.log(`  ${EMAIL} ${error ? "DELETE FAILED: " + error.message : "deleted"}`);
}

async function create() {
  await cleanup(); // idempotent re-run

  const password = "Probe!" + Math.random().toString(36).slice(2, 14);
  const base = process.env.BASE_URL || "http://localhost:3001";

  // generateLink mints the SAME confirmation URL the real signup email carries.
  const { data, error } = await db.auth.admin.generateLink({
    type: "signup",
    email: EMAIL,
    password,
    options: { redirectTo: `${base}/auth/callback?next=/trips&locale=en` },
  });
  if (error) throw new Error("generateLink failed: " + error.message);

  const props = data.properties;
  const record = {
    email: EMAIL,
    userId: data.user?.id ?? null,
    actionLink: props?.action_link ?? null,
    hashedToken: props?.hashed_token ?? null,
    verificationType: props?.verification_type ?? null,
    redirectTo: `${base}/auth/callback?next=/trips&locale=en`,
    createdAt: new Date().toISOString(),
    note: "Throwaway probe account in PRODUCTION. Remove with --cleanup.",
  };
  writeFileSync(OUT, JSON.stringify(record, null, 2));

  console.log(`\n  created ${EMAIL}`);
  console.log(`  user id        ${record.userId}`);
  console.log(`  link type      ${record.verificationType}`);
  console.log(`  has token_hash ${record.hashedToken ? "yes" : "no"}`);
  console.log(`  action_link    ${record.actionLink}`);
  console.log(`\n  manifest -> ${OUT}`);
}

const mode = process.argv[2];
if (mode === "--create") await create();
else if (mode === "--cleanup") await cleanup();
else {
  console.error("usage: tsx scripts/probe-signup-confirmation.mts --create | --cleanup");
  process.exit(1);
}
