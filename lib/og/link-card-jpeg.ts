import "server-only";
import sharp from "sharp";

/**
 * WhatsApp shows no picture for a link whose preview image is over about
 * 300 KB, and a card drawn on a cover photo is over 1 MB as PNG. The link
 * card is therefore sent as JPEG, at the best quality that fits.
 */
export const LINK_CARD_MAX_BYTES = 300_000;
const QUALITIES = [82, 72, 62, 52];

export async function linkCardJpeg(png: ArrayBuffer): Promise<Buffer> {
  let jpeg = Buffer.alloc(0);
  for (const quality of QUALITIES) {
    jpeg = await sharp(Buffer.from(png)).flatten({ background: "#ffffff" }).jpeg({ quality, mozjpeg: true }).toBuffer();
    if (jpeg.length <= LINK_CARD_MAX_BYTES) break;
  }
  return jpeg;
}
