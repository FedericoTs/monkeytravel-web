import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { destinations } from "@/lib/destinations/data";

/**
 * Every /destinations/<slug> link written in a post must point at a guide
 * that exists: the route has no fallback, so anything else is a 404.
 */
const ROOT = join(process.cwd(), "content/blog");
const SLUGS = new Set(destinations.map((d) => d.slug));
const LINK = /\]\((?:\/(?:es|it|pt))?\/destinations\/([a-z0-9-]+)(?:\/[a-z0-9-]+)?\)/g;

function postFiles(): string[] {
  const files: string[] = [];
  for (const dir of ["", "es", "it", "pt"]) {
    for (const name of readdirSync(join(ROOT, dir))) {
      if (name.endsWith(".md")) files.push(join(dir, name));
    }
  }
  return files;
}

describe("blog links to destination guides", () => {
  it("only link guides that exist", () => {
    const files = postFiles();
    expect(files.length).toBeGreaterThan(300);
    const dead: string[] = [];
    for (const file of files) {
      const text = readFileSync(join(ROOT, file), "utf8");
      for (const m of text.matchAll(LINK)) {
        if (m[1] !== "style" && !SLUGS.has(m[1])) dead.push(`${file}: ${m[1]}`);
      }
    }
    expect(dead).toEqual([]);
  });
});
