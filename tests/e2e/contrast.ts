import type { Locator } from "@playwright/test";

/**
 * The contrast of the words in `locator` against what is behind them: every
 * background from the page down to the words, laid over white, with the words'
 * own opacity. For words on flat colour; words over a photo or a gradient need
 * their own measure (result-sky.spec.ts).
 */
export function contrastOf(locator: Locator): Promise<number> {
  return locator.evaluate((element) => {
    // Any CSS colour (the palette is oklch) as sRGB, through one pixel of a canvas.
    const pixel = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
    const parse = (css: string) => {
      pixel.clearRect(0, 0, 1, 1);
      pixel.fillStyle = css;
      pixel.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = pixel.getImageData(0, 0, 1, 1).data;
      return { rgb: [r, g, b], alpha: a / 255 };
    };
    const over = (top: number[], alpha: number, under: number[]) => top.map((v, k) => v * alpha + under[k] * (1 - alpha));
    const luminance = (rgb: number[]) =>
      rgb
        .map((v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4))
        .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
    const chain: Element[] = [];
    for (let e: Element | null = element; e; e = e.parentElement) chain.unshift(e);
    let behind = [255, 255, 255];
    let opacity = 1;
    for (const e of chain) {
      const style = getComputedStyle(e);
      const background = parse(style.backgroundColor);
      if (background.alpha > 0) behind = over(background.rgb, background.alpha, behind);
      opacity *= Number(style.opacity);
    }
    const ink = parse(getComputedStyle(element).color);
    const words = over(ink.rgb, ink.alpha * opacity, behind);
    const [hi, lo] = [luminance(words), luminance(behind)].sort((a, b) => b - a);
    return (hi + 0.05) / (lo + 0.05);
  });
}
