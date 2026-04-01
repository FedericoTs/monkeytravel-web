/**
 * Render a Remotion video composition to MP4.
 *
 * Usage:
 *   npx ts-node scripts/render-video.ts --dest tokyo --locale en
 *   npx ts-node scripts/render-video.ts --dest paris --locale it
 *   npx ts-node scripts/render-video.ts --all    # Render all destinations × all locales
 */

import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import path from 'path';
import fs from 'fs';

const ENTRY_POINT = path.resolve(__dirname, '../video/index.ts');
const OUTPUT_DIR = path.resolve(__dirname, '../video/output');

const LOCALES = ['en', 'es', 'it'] as const;

// Parse CLI args
const args = process.argv.slice(2);
const destIndex = args.indexOf('--dest');
const localeIndex = args.indexOf('--locale');
const renderAll = args.includes('--all');

async function renderDestination(destination: string, locale: string) {
  const outputFile = path.join(OUTPUT_DIR, `${destination}-${locale}-reel.mp4`);

  console.log(`\n🎬 Rendering: ${destination} (${locale})`);
  console.log(`   Output: ${outputFile}`);

  const bundleLocation = await bundle({
    entryPoint: ENTRY_POINT,
    webpackOverride: (config) => config,
  });

  const composition = await selectComposition({
    serveUrl: bundleLocation,
    id: 'DestinationReel',
    inputProps: { destination, locale },
  });

  await renderMedia({
    composition,
    serveUrl: bundleLocation,
    codec: 'h264',
    outputLocation: outputFile,
    inputProps: { destination, locale },
  });

  console.log(`   ✅ Done: ${outputFile}`);
  return outputFile;
}

async function main() {
  // Ensure output dir exists
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  if (renderAll) {
    // Dynamic import to get all slugs
    const { getAllDestinationSlugs } = await import('../video/data');
    const slugs = getAllDestinationSlugs();

    console.log(`Rendering ${slugs.length} destinations × ${LOCALES.length} locales = ${slugs.length * LOCALES.length} videos\n`);

    for (const slug of slugs) {
      for (const locale of LOCALES) {
        try {
          await renderDestination(slug, locale);
        } catch (err) {
          console.error(`   ❌ Failed: ${slug}-${locale}:`, (err as Error).message);
        }
      }
    }
  } else {
    const destination = destIndex !== -1 ? args[destIndex + 1] : 'tokyo';
    const locale = localeIndex !== -1 ? args[localeIndex + 1] : 'en';

    if (!destination) {
      console.error('Usage: npx ts-node scripts/render-video.ts --dest <slug> --locale <en|es|it>');
      process.exit(1);
    }

    await renderDestination(destination, locale);
  }
}

main().catch((err) => {
  console.error('Render failed:', err);
  process.exit(1);
});
