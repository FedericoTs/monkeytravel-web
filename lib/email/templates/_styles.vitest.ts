/** @vitest-environment node */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

/**
 * The templates take their common styles from ./_styles. A template holding
 * its own copy of one would drift from the rest unnoticed, which is how
 * eleven copies of the heading style came about.
 */

const dir = path.join(process.cwd(), "lib/email/templates");
const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const read = (f: string) => readFileSync(path.join(dir, f), "utf8").replace(/\r\n/g, "\n");

const shared = new Map(
  [...read("_styles.ts").matchAll(/^export const (\w+): CSSProperties = (\{[\s\S]*?\n\});/gm)].map((m) => [norm(m[2]), m[1]])
);

it("finds the shared styles", () => {
  expect([...shared.values()]).toEqual(
    expect.arrayContaining(["h1", "leadText", "bodyText", "linkText", "button", "largeButton", "secondaryButton", "signOff"])
  );
});

it("no template keeps its own copy of a shared style", () => {
  const copies: string[] = [];
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".tsx") && !f.startsWith("_") && !f.includes(".vitest."))) {
    for (const m of read(f).matchAll(/^const (\w+): React\.CSSProperties = (\{[\s\S]*?\n\});/gm)) {
      const twin = shared.get(norm(m[2]));
      if (twin) copies.push(`${f}: ${m[1]} is ./_styles' ${twin}`);
    }
  }
  expect(copies).toEqual([]);
});
