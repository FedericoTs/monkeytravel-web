import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Every literal key a translator is asked for exists in English (and, through
 * key-parity.vitest.ts, in every locale). next-intl renders a missing key as
 * its raw path, so a key deleted from the catalogs while a component still
 * reads it, or a key spelt differently in the two, is a raw string on the page.
 *
 * A translator is `const <name> = useTranslations("<ns>")`, `await
 * getTranslations("<ns>")` or getTranslations({ namespace: "<ns>" }); a call
 * `<name>("<key>")` (or .rich/.raw/.markup/.has) is read against the nearest
 * earlier declaration of <name> in its file. Keys built at run time are not
 * checked.
 */

const ROOT = process.cwd();
const CATALOGS: Record<string, unknown> = Object.fromEntries(
  readdirSync(join(ROOT, "messages", "en"))
    .filter((file) => file.endsWith(".json"))
    .map((file) => [file.replace(/\.json$/, ""), JSON.parse(readFileSync(join(ROOT, "messages", "en", file), "utf8"))])
);

function inEnglish(key: string): boolean {
  let node: unknown = CATALOGS;
  for (const part of key.split(".")) {
    if (!node || typeof node !== "object" || !(part in node)) return false;
    node = (node as Record<string, unknown>)[part];
  }
  return true;
}

const DECLARATION =
  /(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*(?:"([^"]*)"|\{[^}]*namespace:\s*"([^"]*)"[^}]*\}|\))/g;

function keysAskedFor(): { at: string; key: string }[] {
  const files = execSync("git ls-files app components hooks lib", { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter((file) => /\.(ts|tsx)$/.test(file) && !/vitest|\.spec\.|\.test\./.test(file));
  const asked: { at: string; key: string }[] = [];
  for (const file of files) {
    const source = readFileSync(join(ROOT, file), "utf8");
    const translators = [...source.matchAll(DECLARATION)].map((m) => ({ name: m[1], ns: m[2] ?? m[3] ?? "", at: m.index }));
    if (translators.length === 0) continue;
    const names = [...new Set(translators.map((tr) => tr.name))].join("|");
    const call = new RegExp(`(?<![\\w.])(${names})(?:\\.(?:rich|raw|markup|has))?\\(\\s*"([^"$]+)"`, "g");
    for (const m of source.matchAll(call)) {
      const translator = translators.filter((tr) => tr.name === m[1] && tr.at < m.index).pop();
      if (!translator) continue;
      const line = source.slice(0, m.index).split("\n").length;
      asked.push({ at: `${file}:${line}`, key: translator.ns ? `${translator.ns}.${m[2]}` : m[2] });
    }
  }
  return asked;
}

describe("message keys the code asks for", () => {
  const asked = keysAskedFor();

  it("finds the translators (the guard is not vacuous)", () => {
    expect(asked.length).toBeGreaterThan(1500);
    expect(asked.some(({ key }) => key === "common.map.showRoute")).toBe(true);
  });

  it("are all in the English catalogs", () => {
    expect(asked.filter(({ key }) => !inEnglish(key)).map(({ at, key }) => `${at} ${key}`)).toEqual([]);
  });
});
