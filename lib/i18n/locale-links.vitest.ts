import { expect, it } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Pages in a locale link through the app's Link (lib/i18n/link.tsx), which
 * puts the page's locale in front of the href. A raw next/link to
 * "/trips/new" on /es/... sends the visitor, and crawlers, to the English
 * page. Raw next/link stays only where the page has no locale (admin) or the
 * href already carries it.
 */
const HREF_CARRIES_LOCALE = [
  // bioUrl is built as `${localePrefix}/about/authors/<slug>`.
  "components/blog/BlogByline.tsx",
];

it("only unlocalized pages and pre-localized hrefs use next/link", () => {
  const root = process.cwd();
  const files = execSync("git ls-files app components hooks lib", { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter((file) => /\.(ts|tsx)$/.test(file) && !/vitest|\.spec\.|\.test\./.test(file));
  const raw = files.filter((file) => /from\s+["']next\/link["']/.test(readFileSync(join(root, file), "utf8")));
  expect(raw.length).toBeGreaterThan(0);
  expect(raw.filter((file) => !file.startsWith("app/admin/") && !HREF_CARRIES_LOCALE.includes(file))).toEqual([]);
});
