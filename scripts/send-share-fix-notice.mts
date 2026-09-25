/**
 * One-off notice (2026-09-25): tell the owners of shared trips that sharing
 * no longer locks them out of their trip (#183/#184/#185). Approved by
 * Federico on 2026-09-25.
 *
 * Recipients: owners of live trips that have a share link, real accounts only.
 * Language: the owner's most recent shared trip (trip_meta.locale), else
 * English. Most recent sharers first.
 *
 * Every email goes through dispatchEmail (template "share_fix_notice"), so the
 * app's own rules apply to each recipient: the marketing/email opt-outs, the
 * bounce/complaint list, and idempotency — one send per user, ever. Re-running
 * only reaches the owners not sent yet. Every attempt lands in email_log.
 *
 * Resend's free plan caps transactional mail at 100 a day (UTC calendar day),
 * shared with invites, votes and reminders: --limit keeps a batch inside it.
 *
 *   npx tsx scripts/send-share-fix-notice.mts                    # dry run
 *   npx tsx scripts/send-share-fix-notice.mts --send --limit 50  # send
 */

import fs from "node:fs";
import path from "node:path";

// Environment first: lib/email/client reads RESEND_API_KEY at import time,
// so the pipeline is imported only after this.
for (const line of fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

/* eslint-disable @typescript-eslint/no-explicit-any */
// tsx loads the app's TS modules as CommonJS, whose namespace `default` is
// the whole module.exports; loaded as ESM, the namespace is the exports.
const exportsOf = (mod: any) => (mod.default && typeof mod.default === "object" ? mod.default : mod);

const CAMPAIGN = "share_fix_2026_09_25";
const TEST_ADDRESS = /(@test\.local|@example\.(com|test)|@trawell\.test|^mt-(e2e|probe)\+)/i;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Locale = "en" | "es" | "it" | "pt";
interface Recipient {
  userId: string;
  email: string;
  locale: Locale;
}

async function recipients(db: any, normalizeEmailLocale: (v: unknown) => Locale): Promise<Recipient[]> {
  const { data: trips, error } = await db
    .from("trips")
    .select("user_id, trip_meta, created_at")
    .not("share_token", "is", null)
    .is("deleted_at", null)
    .not("user_id", "is", null)
    .order("created_at", { ascending: false });
  if (error) throw error;
  const localeOf = new Map<string, Locale>();
  for (const t of trips ?? []) {
    if (!localeOf.has(t.user_id)) localeOf.set(t.user_id, normalizeEmailLocale(t.trip_meta?.locale));
  }

  const emailOf = new Map<string, string>();
  for (let page = 1; page < 50; page++) {
    const { data, error: e } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (e) throw e;
    for (const u of data.users) if (u.email) emailOf.set(u.id, u.email.trim().toLowerCase());
    if (data.users.length < 1000) break;
  }

  // dispatchEmail checks opt-outs and suppression again per send; checking
  // here too keeps --limit counting real sends.
  const ids = [...localeOf.keys()];
  const optedOut = new Set<string>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data: rows, error: pe } = await db.from("users").select("id, notification_settings").in("id", ids.slice(i, i + 200));
    if (pe) throw pe;
    for (const p of rows ?? []) {
      const ns = (p.notification_settings ?? {}) as Record<string, unknown>;
      if (ns.marketingNotifications === false || ns.emailNotifications === false) optedOut.add(p.id);
    }
  }

  const { data: bad, error: be } = await db.from("email_log").select("recipient_email").in("status", ["bounced", "complained"]);
  if (be) throw be;
  const suppressed = new Set((bad ?? []).map((r: any) => String(r.recipient_email).trim().toLowerCase()));

  const { data: done, error: de } = await db
    .from("email_log")
    .select("idempotency_key")
    .like("idempotency_key", `${CAMPAIGN}:%`)
    .in("status", ["sent", "queued"]);
  if (de) throw de;
  const alreadySent = new Set((done ?? []).map((r: any) => String(r.idempotency_key).slice(CAMPAIGN.length + 1)));

  const out: Recipient[] = [];
  const skipped = { optedOut: 0, suppressed: 0, test: 0, noEmail: 0, alreadySent: 0 };
  for (const [userId, locale] of localeOf) {
    const email = emailOf.get(userId);
    if (!email) { skipped.noEmail++; continue; }
    if (TEST_ADDRESS.test(email)) { skipped.test++; continue; }
    if (optedOut.has(userId)) { skipped.optedOut++; continue; }
    if (suppressed.has(email)) { skipped.suppressed++; continue; }
    if (alreadySent.has(userId)) { skipped.alreadySent++; continue; }
    out.push({ userId, email, locale });
  }
  console.log(`owners of shared trips: ${localeOf.size}; skipped: ${JSON.stringify(skipped)}`);
  return out;
}

async function main() {
  const send = process.argv.includes("--send");
  const limitArg = process.argv.indexOf("--limit");
  const limit = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity;
  if (send && !(limit > 0)) throw new Error("--send needs --limit N (the Resend daily cap is shared with the app's own mail)");

  const supabase: any = await import("@supabase/supabase-js");
  const createClient = supabase.createClient ?? supabase.default?.createClient;
  const reactEmail: any = await import("@react-email/render");
  const render = reactEmail.render ?? reactEmail.default?.render;
  const Notice = exportsOf(await import("../lib/email/templates/ShareFixNotice"));
  const { normalizeEmailLocale } = exportsOf(await import("../lib/email/copy"));
  const { dispatchEmail } = exportsOf(await import("../lib/email/send"));
  for (const [name, fn] of Object.entries({ createClient, render, Component: Notice.default, normalizeEmailLocale, dispatchEmail })) {
    if (typeof fn !== "function") throw new Error(`import failed: ${name}`);
  }

  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const all = await recipients(db, normalizeEmailLocale);
  const batch = all.slice(0, Number.isFinite(limit) ? limit : all.length);

  const count = (list: Recipient[]) => {
    const by: Record<string, number> = {};
    for (const r of list) by[r.locale] = (by[r.locale] ?? 0) + 1;
    return JSON.stringify(by);
  };
  console.log(`not sent yet: ${all.length} ${count(all)}; this run: ${batch.length} ${count(batch)}`);

  const outDir = path.join(process.cwd(), "out");
  fs.mkdirSync(outDir, { recursive: true });
  const locales = [...new Set(all.map((r) => r.locale))];
  for (const locale of locales) {
    const html = await render(Notice.default({ locale }));
    fs.writeFileSync(path.join(outDir, `${CAMPAIGN}-${locale}.html`), html, "utf8");
  }
  console.log(`previews: out/${CAMPAIGN}-{${locales.join(",")}}.html`);

  if (!send) {
    console.log("dry run: nothing sent. Re-run with --send --limit N.");
    return;
  }

  const outcomes: Record<string, number> = {};
  const log: Array<{ userId: string; locale: Locale; status: string; error?: string }> = [];
  for (const [i, r] of batch.entries()) {
    const res = await dispatchEmail({
      recipientEmail: r.email,
      recipientUserId: r.userId,
      template: { id: "share_fix_notice", props: { locale: r.locale } },
      idempotencyKey: `${CAMPAIGN}:${r.userId}`,
      locale: r.locale,
      metadata: { campaign: CAMPAIGN },
    });
    outcomes[res.status] = (outcomes[res.status] ?? 0) + 1;
    log.push({ userId: r.userId, locale: r.locale, status: res.status, ...(res.error ? { error: res.error } : {}) });
    if (!res.ok) console.log(`  #${i + 1} ${r.userId.slice(0, 8)} ${res.status}: ${res.error}`);
    if (/quota|rate limit|too many/i.test(res.error ?? "")) {
      console.log("  Resend quota/rate limit hit: stopping this run.");
      break;
    }
    await sleep(500);
  }
  fs.writeFileSync(path.join(outDir, `${CAMPAIGN}-results-${Date.now()}.json`), JSON.stringify(log, null, 2));
  console.log("outcomes:", outcomes);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
