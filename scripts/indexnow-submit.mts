/**
 * Push changed URLs to IndexNow (Bing / Yandex / Seznam / Naver — and thereby
 * ChatGPT's search grounding, which reads Bing's index).
 *
 * Reads the LIVE sitemaps rather than importing app/sitemap.ts, so it submits
 * exactly what is actually published — not what the working tree would build.
 *
 * Usage:
 *   npx tsx scripts/indexnow-submit.mts --dry-run          # show, send nothing
 *   npx tsx scripts/indexnow-submit.mts --since 7          # lastmod within 7 days
 *   npx tsx scripts/indexnow-submit.mts --url <a> --url <b>
 *   npx tsx scripts/indexnow-submit.mts                    # everything (rare)
 *
 * Prefer --since after a content deploy. Submitting the whole sitemap on every
 * run is not rewarded and is what "spammy" looks like to the endpoint.
 *
 * Deliberately NOT called from the build or the content pipeline: submission
 * stays an explicit act.
 */

// Dynamic import on purpose. This file is .mts (strict ESM) while the project
// tsconfig emits lib/ as CommonJS, so a static named import fails at load with
// "does not provide an export named 'INDEXNOW_HOST'". await import() goes
// through the interop layer and resolves the named exports correctly.
const { submitToIndexNow, INDEXNOW_HOST } = await import("../lib/seo/indexnow");

const SITEMAPS = [
  `https://${INDEXNOW_HOST}/sitemap.xml`,
  `https://${INDEXNOW_HOST}/sitemap-trips.xml`,
  `https://${INDEXNOW_HOST}/sitemap-creators.xml`,
];

interface Entry {
  loc: string;
  lastmod?: string;
}

function parseArgs(argv: string[]) {
  const dryRun = argv.includes("--dry-run");
  const urls: string[] = [];
  let sinceDays: number | undefined;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--url" && argv[i + 1]) urls.push(argv[++i]);
    if (argv[i] === "--since" && argv[i + 1]) {
      const n = Number(argv[++i]);
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error("--since expects a positive number of days");
      }
      sinceDays = n;
    }
  }
  return { dryRun, urls, sinceDays };
}

/**
 * Minimal <url><loc>/<lastmod> reader.
 *
 * A sitemap index nests <sitemap><loc> entries instead, which this
 * intentionally does not follow — the three sitemaps above are already the
 * leaves. If that ever changes, this returns nothing rather than submitting
 * sitemap URLs as if they were pages, which is the safer failure.
 */
function parseSitemap(xml: string): Entry[] {
  const entries: Entry[] = [];
  const blocks = xml.match(/<url\b[\s\S]*?<\/url>/g) ?? [];
  for (const block of blocks) {
    const loc = block.match(/<loc>\s*([\s\S]*?)\s*<\/loc>/)?.[1];
    if (!loc) continue;
    const lastmod = block.match(/<lastmod>\s*([\s\S]*?)\s*<\/lastmod>/)?.[1];
    entries.push({
      loc: loc.replace(/&amp;/g, "&").trim(),
      lastmod: lastmod?.trim(),
    });
  }
  return entries;
}

async function fetchSitemap(url: string): Promise<Entry[]> {
  const res = await fetch(url, { headers: { "User-Agent": "monkeytravel-indexnow" } });
  if (!res.ok) {
    console.warn(`  ! ${url} -> HTTP ${res.status}, skipping`);
    return [];
  }
  return parseSitemap(await res.text());
}

async function main() {
  const { dryRun, urls: explicitUrls, sinceDays } = parseArgs(process.argv.slice(2));

  let candidates: string[];

  if (explicitUrls.length > 0) {
    candidates = explicitUrls;
    console.log(`Submitting ${candidates.length} explicitly listed URL(s).`);
  } else {
    console.log("Reading live sitemaps…");
    const all: Entry[] = [];
    for (const sm of SITEMAPS) {
      const entries = await fetchSitemap(sm);
      console.log(`  ${sm} -> ${entries.length} urls`);
      all.push(...entries);
    }

    if (sinceDays === undefined) {
      candidates = all.map((e) => e.loc);
      console.log(
        `\nNo --since given: submitting ALL ${candidates.length} URLs. ` +
          `Prefer --since <days> after a content deploy.`
      );
    } else {
      const cutoff = Date.now() - sinceDays * 86_400_000;
      const dated = all.filter((e) => e.lastmod);
      candidates = dated
        .filter((e) => {
          const t = Date.parse(e.lastmod!);
          return Number.isFinite(t) && t >= cutoff;
        })
        .map((e) => e.loc);

      const undatedCount = all.length - dated.length;
      console.log(
        `\n${candidates.length} of ${all.length} URLs have lastmod within ${sinceDays}d.`
      );
      if (undatedCount > 0) {
        // Say this out loud: a URL with no lastmod is invisible to --since and
        // would otherwise be silently dropped from every incremental run.
        console.log(
          `  note: ${undatedCount} URL(s) carry no <lastmod> and were NOT considered.`
        );
      }
    }
  }

  if (candidates.length === 0) {
    console.log("Nothing to submit.");
    return;
  }

  const result = await submitToIndexNow(candidates, { dryRun });

  if (result.skipped.length > 0) {
    console.log(`\nSkipped ${result.skipped.length} off-host/invalid URL(s):`);
    for (const s of result.skipped.slice(0, 10)) console.log(`  - ${s}`);
    if (result.skipped.length > 10) console.log(`  … and ${result.skipped.length - 10} more`);
  }

  if (dryRun) {
    console.log(`\nDRY RUN — would submit ${result.submitted} URL(s) in ${result.batches.length} batch(es).`);
    return;
  }

  for (const b of result.batches) {
    console.log(`  batch of ${b.count}: HTTP ${b.status}${b.ok ? " ok" : ` FAILED ${b.body ?? ""}`}`);
  }
  console.log(`\nSubmitted ${result.submitted} URL(s). ${result.ok ? "All batches accepted." : "SOME BATCHES FAILED."}`);

  if (!result.ok) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
