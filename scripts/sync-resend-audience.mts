/**
 * Sync opted-in contacts into a Resend Audience (for marketing broadcasts).
 *
 * This is LIST MANAGEMENT, not sending — but it still adds people to a
 * marketing list, so it is DRY-RUN by default and only writes when you pass
 * `--apply`.
 *
 * Data flow (the recipient list comes from Supabase, read separately):
 *   1. Query Supabase for opted-in users + email_subscribers (done by the
 *      agent via the Supabase MCP, or any export) and write a JSON file:
 *        [ { "email": "a@b.com", "firstName": "Ada", "locale": "en" }, ... ]
 *   2. Run this script to upsert them into the Resend Audience.
 *
 * Usage:
 *   RESEND_API_KEY=re_… npx tsx scripts/sync-resend-audience.mts [file] [--apply]
 *   # defaults: file = out/audience-contacts.json, AUDIENCE_NAME env or
 *   #           "MonkeyTravel Marketing"
 *
 * Consent (OPT-OUT): include all users EXCEPT explicit unsubscribes
 * (marketingNotifications === false), plus the email_subscribers waitlist.
 */

import fs from "node:fs";
import path from "node:path";

const apiKey = process.env.RESEND_API_KEY;
if (!apiKey) {
  console.error("RESEND_API_KEY is required");
  process.exit(1);
}

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const file =
  args.find((a) => !a.startsWith("--")) ||
  process.env.AUDIENCE_FILE ||
  path.join(process.cwd(), "out", "audience-contacts.json");
const audienceName = process.env.AUDIENCE_NAME || "MonkeyTravel Marketing";

interface Contact {
  email: string;
  firstName?: string;
  lastName?: string;
  unsubscribed?: boolean;
}

const BASE = "https://api.resend.com";
const headers = {
  Authorization: `Bearer ${apiKey}`,
  "Content-Type": "application/json",
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function findOrCreateAudience(): Promise<string> {
  const list = await fetch(`${BASE}/audiences`, { headers });
  if (list.ok) {
    const json = (await list.json()) as { data?: Array<{ id: string; name: string }> };
    const found = json.data?.find((a) => a.name === audienceName);
    if (found) return found.id;
  }
  if (!apply) return "(dry-run: would create audience)";
  const created = await fetch(`${BASE}/audiences`, {
    method: "POST",
    headers,
    body: JSON.stringify({ name: audienceName }),
  });
  if (!created.ok) {
    throw new Error(`create audience failed: ${created.status} ${await created.text()}`);
  }
  const json = (await created.json()) as { id: string };
  return json.id;
}

async function upsertContact(audienceId: string, c: Contact) {
  const res = await fetch(`${BASE}/audiences/${audienceId}/contacts`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      email: c.email,
      first_name: c.firstName,
      last_name: c.lastName,
      unsubscribed: c.unsubscribed ?? false,
    }),
  });
  // Resend returns 201 on create; an already-present email may 409/422 —
  // treat those as "already in audience" rather than a failure.
  if (res.ok) return "added";
  if (res.status === 409 || res.status === 422) return "exists";
  console.warn(`  ✗ ${c.email}: ${res.status} ${await res.text()}`);
  return "failed";
}

async function main() {
  if (!fs.existsSync(file)) {
    console.error(
      `Contacts file not found: ${file}\n` +
        `Create it first (JSON array of {email, firstName?, lastName?}).`
    );
    process.exit(1);
  }
  const contacts = JSON.parse(fs.readFileSync(file, "utf8")) as Contact[];
  const unique = [
    ...new Map(contacts.map((c) => [c.email.trim().toLowerCase(), c])).values(),
  ];

  console.log(`Audience: "${audienceName}"`);
  console.log(`Contacts file: ${file}  (${unique.length} unique)`);
  console.log(apply ? "Mode: APPLY (writing to Resend)\n" : "Mode: DRY-RUN (pass --apply to write)\n");

  const audienceId = await findOrCreateAudience();
  console.log(`Audience id: ${audienceId}\n`);

  if (!apply) {
    unique.slice(0, 10).forEach((c) => console.log(`  would add: ${c.email}`));
    if (unique.length > 10) console.log(`  …and ${unique.length - 10} more`);
    console.log("\nDry run complete. Re-run with --apply to push.");
    return;
  }

  const tally = { added: 0, exists: 0, failed: 0 };
  for (const c of unique) {
    const r = await upsertContact(audienceId, c);
    tally[r] += 1;
    await sleep(220); // stay under 5 req/s
  }
  console.log(
    `\nDone. added=${tally.added} exists=${tally.exists} failed=${tally.failed}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
