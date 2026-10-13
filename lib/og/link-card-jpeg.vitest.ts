/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { LINK_CARD_MAX_BYTES, linkCardJpeg } from "./link-card-jpeg";

/**
 * The link card is a JPEG under WhatsApp's preview limit, even when the PNG it
 * comes from is drawn on a photo and weighs well over a megabyte.
 */

const WIDTH = 1200;
const HEIGHT = 630;

/** A photo-like card: a gradient with grain, which PNG compresses badly. */
async function photoLikePng(): Promise<ArrayBuffer> {
  const pixels = Buffer.alloc(WIDTH * HEIGHT * 3);
  let seed = 7;
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const grain = (seed % 41) - 20;
      const i = (y * WIDTH + x) * 3;
      pixels[i] = Math.max(0, Math.min(255, 40 + (x * 180) / WIDTH + grain));
      pixels[i + 1] = Math.max(0, Math.min(255, 60 + (y * 120) / HEIGHT + grain));
      pixels[i + 2] = Math.max(0, Math.min(255, 90 + grain));
    }
  }
  const png = await sharp(pixels, { raw: { width: WIDTH, height: HEIGHT, channels: 3 } }).png().toBuffer();
  return png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer;
}

describe("linkCardJpeg", () => {
  it("turns a heavy PNG card into a JPEG under the preview limit, at full size", async () => {
    const png = await photoLikePng();
    expect(png.byteLength).toBeGreaterThan(LINK_CARD_MAX_BYTES);
    const jpeg = await linkCardJpeg(png);
    expect([...jpeg.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
    expect(jpeg.length).toBeLessThanOrEqual(LINK_CARD_MAX_BYTES);
    const meta = await sharp(jpeg).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["jpeg", WIDTH, HEIGHT]);
  });

  it("paints transparent parts white rather than black", async () => {
    const clear = await sharp({ create: { width: 40, height: 20, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .png()
      .toBuffer();
    const jpeg = await linkCardJpeg(clear.buffer.slice(clear.byteOffset, clear.byteOffset + clear.byteLength) as ArrayBuffer);
    const { data } = await sharp(jpeg).raw().toBuffer({ resolveWithObject: true });
    expect(Math.min(...data)).toBeGreaterThan(240);
  });
});
