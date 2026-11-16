// @vitest-environment node
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Pictures an article shows from the site's own folder. A markdown image renders as a plain <img>,
 * so nothing at build time checks its file: a renamed or missing file is a broken picture on a live
 * page, and a picture without words is invisible to screen readers and to image search.
 */
const ROOT = process.cwd();
const markdownFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? markdownFiles(p) : p.endsWith(".md") ? [p] : [];
  });
const IMAGE = /!\[([^\]]*)\]\((\/[^)\s]+)\)/g;
const images = markdownFiles(join(ROOT, "content/blog")).flatMap((file) =>
  [...readFileSync(file, "utf8").matchAll(IMAGE)].map((m) => ({
    file: file.slice(ROOT.length + 1).replace(/\\/g, "/"),
    alt: m[1],
    src: m[2],
  })),
);

describe("pictures inside articles", () => {
  it("are files of the site, each described in words", () => {
    expect(images.filter((i) => !existsSync(join(ROOT, "public", i.src))).map((i) => `${i.file}: ${i.src}`)).toEqual([]);
    expect(images.filter((i) => i.alt.trim().length < 20).map((i) => `${i.file}: ${i.src}`)).toEqual([]);
  });

  it("include the eclipse guide's two maps, in each language's own words", () => {
    for (const lang of ["en", "es", "it", "pt"]) {
      const file = `content/blog/${lang === "en" ? "" : `${lang}/`}solar-eclipse-2027.md`;
      expect(images.filter((i) => i.file === file).map((i) => i.src)).toEqual([
        `/images/blog/solar-eclipse-2027-path-${lang}.svg`,
        `/images/blog/solar-eclipse-2027-strait-${lang}.svg`,
      ]);
    }
  });
});
