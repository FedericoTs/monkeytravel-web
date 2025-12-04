import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');
const appDir = path.join(__dirname, '..', 'app');
const logoPath = path.join(publicDir, 'images', 'logo.png');

async function generateIcons() {
  console.log('Starting icon generation from:', logoPath);

  // Read the source logo
  const logoBuffer = fs.readFileSync(logoPath);

  // 1. Generate PNG icons for various sizes
  const sizes = [
    { size: 16, name: 'favicon-16x16.png' },
    { size: 32, name: 'favicon-32x32.png' },
    { size: 180, name: 'apple-touch-icon.png' },
    { size: 192, name: 'icon-192.png' },
    { size: 512, name: 'icon-512.png' },
  ];

  for (const { size, name } of sizes) {
    const outputPath = path.join(publicDir, name);
    await sharp(logoBuffer)
      .resize(size, size, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
      .png()
      .toFile(outputPath);
    console.log(`Created: ${name} (${size}x${size})`);
  }

  // 2. Create favicon.ico (multi-size ICO file)
  // Sharp can create PNG, we'll use the 32x32 as the main favicon
  const favicon32 = await sharp(logoBuffer)
    .resize(32, 32, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .png()
    .toBuffer();

  // For ICO format, we'll create a PNG and rename it (browsers support PNG favicons)
  const faviconPath = path.join(appDir, 'icon.png');
  await sharp(logoBuffer)
    .resize(32, 32, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .png()
    .toFile(faviconPath);
  console.log('Created: app/icon.png (32x32 for Next.js App Router)');

  // 3. Create apple-icon.png in app directory (Next.js convention)
  const appleIconPath = path.join(appDir, 'apple-icon.png');
  await sharp(logoBuffer)
    .resize(180, 180, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .png()
    .toFile(appleIconPath);
  console.log('Created: app/apple-icon.png (180x180)');

  // 4. Create OG Image (1200x630) with branding
  const ogWidth = 1200;
  const ogHeight = 630;
  const logoSize = 300;

  // Create a branded OG image with gradient background
  const ogBackground = await sharp({
    create: {
      width: ogWidth,
      height: ogHeight,
      channels: 4,
      background: { r: 255, g: 250, b: 245, alpha: 1 } // Warm white matching brand
    }
  }).png().toBuffer();

  // Resize logo for OG image
  const ogLogo = await sharp(logoBuffer)
    .resize(logoSize, logoSize, { fit: 'contain', background: { r: 255, g: 250, b: 245, alpha: 0 } })
    .png()
    .toBuffer();

  // Composite the logo onto the background
  const ogImagePath = path.join(publicDir, 'og-image.png');
  await sharp(ogBackground)
    .composite([
      {
        input: ogLogo,
        left: Math.floor((ogWidth - logoSize) / 2),
        top: Math.floor((ogHeight - logoSize) / 2) - 50
      }
    ])
    .png()
    .toFile(ogImagePath);
  console.log(`Created: og-image.png (${ogWidth}x${ogHeight})`);

  // Also create opengraph-image.png in app directory for Next.js convention
  const ogAppPath = path.join(appDir, 'opengraph-image.png');
  fs.copyFileSync(ogImagePath, ogAppPath);
  console.log('Created: app/opengraph-image.png');

  // Create Twitter image (same as OG for consistency)
  const twitterPath = path.join(appDir, 'twitter-image.png');
  fs.copyFileSync(ogImagePath, twitterPath);
  console.log('Created: app/twitter-image.png');

  console.log('\nAll icons generated successfully!');
}

generateIcons().catch(console.error);
