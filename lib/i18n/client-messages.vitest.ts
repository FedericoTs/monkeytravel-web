import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import * as lists from "./client-messages";
import { MARKETING_CLIENT_NAMESPACES, pickMessages } from "./client-messages";

describe("pickMessages", () => {
  const messages = {
    common: { buttons: { save: "Save" }, share: { title: "Share", notifications: { on: "On" } }, footer: { about: "About" } },
    consent: { banner: "Cookies?" },
    blog: { index: "Blog" },
  };

  it("keeps only the listed subtrees, nested as in the source", () => {
    expect(pickMessages(messages, ["common.buttons", "common.share.notifications", "consent"])).toEqual({
      common: { buttons: { save: "Save" }, share: { notifications: { on: "On" } } },
      consent: { banner: "Cookies?" },
    });
  });

  it("lets a listed ancestor win over a listed descendant, and ignores paths that do not exist", () => {
    expect(pickMessages(messages, ["common.share.notifications", "common.share", "nope", "blog.missing"])).toEqual({
      common: { share: { title: "Share", notifications: { on: "On" } } },
    });
  });

  it("never touches the source", () => {
    const before = JSON.stringify(messages);
    pickMessages(messages, ["common.buttons", "common"]);
    pickMessages(messages, ["common.share.notifications"]);
    expect(JSON.stringify(messages)).toBe(before);
  });
});

/**
 * Every client module a route can render must find its messages in the list
 * its nearest provider uses. A miss renders raw keys, and only in the browser.
 */
const ROOT = resolve(__dirname, "../..");
const LOCALE_DIR = join(ROOT, "app", "[locale]");
const EXT = [".tsx", ".ts", ".jsx", ".js", ".mjs"];
const sources = new Map<string, string>();
const read = (file: string) => {
  let src = sources.get(file);
  if (src === undefined) sources.set(file, (src = readFileSync(file, "utf8")));
  return src;
};

function resolveImport(from: string, spec: string): string | null {
  const base = spec.startsWith("@/") ? join(ROOT, spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(from), spec) : null;
  if (!base) return null;
  for (const candidate of [base, ...EXT.map((e) => base + e), ...EXT.map((e) => join(base, `index${e}`))]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function importsOf(src: string): string[] {
  const out: string[] = [];
  const re = /(?:import|export)\s+(?:[^"'()]*?\s+from\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;
  for (const m of src.matchAll(re)) out.push(m[1] ?? m[2]);
  return out;
}

const isClientModule = (src: string) =>
  /^["']use client["']/.test(src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "").trimStart());

function routeFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const file = join(dir, name);
    if (statSync(file).isDirectory()) routeFiles(file, acc);
    else if (/^(page|layout|template|error|not-found|loading|default)\.tsx$/.test(name)) acc.push(file);
  }
  return acc;
}

/** Client modules reachable from `entry`: those with the directive, and everything they import. */
function clientModulesOf(entry: string): string[] {
  const seen = new Set<string>();
  const found = new Set<string>();
  const stack = [{ file: entry, client: false }];
  while (stack.length) {
    const { file, client } = stack.pop()!;
    const key = `${file}#${client}`;
    if (seen.has(key) || /\.vitest\.tsx?$/.test(file)) continue;
    seen.add(key);
    const src = read(file);
    const isClient = client || isClientModule(src);
    if (isClient) found.add(file);
    for (const spec of importsOf(src)) {
      const target = resolveImport(file, spec);
      if (target) stack.push({ file: target, client: isClient });
    }
  }
  return [...found];
}

/** The first key segment of every literal key read through `name`, or null when a key is computed. */
function keyPrefixes(src: string, name: string): string[] | null {
  const out = new Set<string>();
  const re = new RegExp(`\\b${name}(?:\\.(?:rich|raw|markup|has))?\\(\\s*("([^"]*)"|'([^']*)'|\`([^\`]*)\`|[^"'\`])`, "g");
  for (const m of src.matchAll(re)) {
    const literal = m[2] ?? m[3] ?? m[4];
    const prefix = literal?.split("${")[0].split(".").find(Boolean);
    if (!prefix) return null;
    out.add(prefix);
  }
  return [...out];
}

/** The message paths a client module needs: the namespaces it opens, narrowed to the keys it reads when they are literal. */
function requiredPaths(src: string): string[] {
  const out = new Set<string>();
  if (/\buseMessages\(/.test(src)) out.add("*");
  const named = /(?:const|let|var)\s+(\w+)\s*=\s*useTranslations\(\s*(?:"([^"]*)"|'([^']*)')?\s*\)/g;
  const seenAt = new Set<number>();
  for (const m of src.matchAll(named)) {
    seenAt.add(m.index! + m[0].indexOf("useTranslations"));
    const ns = m[2] ?? m[3] ?? "";
    if (!ns) {
      out.add("*");
      continue;
    }
    const prefixes = keyPrefixes(src, m[1]);
    if (prefixes === null || ns.includes(".")) out.add(ns);
    else for (const prefix of prefixes) out.add(`${ns}.${prefix}`);
  }
  for (const m of src.matchAll(/useTranslations\(\s*(?:"([^"]*)"|'([^']*)')?\s*\)/g)) {
    if (!seenAt.has(m.index!)) out.add(m[1] ?? m[2] ?? "*");
  }
  return [...out];
}

const covers = (list: readonly string[], path: string) => list.some((entry) => path === entry || path.startsWith(`${entry}.`));

/** The list the nearest provider around `entry` uses: a layout on the way up (or the page itself) that picks messages. */
function listFor(entry: string): { name: string; paths: readonly string[] } {
  let dir = dirname(entry);
  const candidates = [entry];
  while (dir.startsWith(LOCALE_DIR)) {
    candidates.push(join(dir, "layout.tsx"));
    if (dir === LOCALE_DIR) break;
    dir = dirname(dir);
  }
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    const name = /pickMessages\(\s*messages\s*,\s*(\w+)\s*\)/.exec(read(file))?.[1];
    if (name) return { name, paths: (lists as Record<string, unknown>)[name] as readonly string[] };
  }
  return { name: "MARKETING_CLIENT_NAMESPACES", paths: MARKETING_CLIENT_NAMESPACES };
}

describe("every route's client modules find their messages", () => {
  const entries = routeFiles(LOCALE_DIR);

  it("sees the marketing and the app routes", () => {
    expect(entries.length).toBeGreaterThan(20);
    expect(entries.some((file) => file.includes(`${join("(app)", "trips", "new")}`))).toBe(true);
  });

  for (const entry of entries) {
    it(relative(ROOT, entry).replace(/\\/g, "/"), () => {
      const { name, paths } = listFor(entry);
      expect(paths, `${name} is not exported by lib/i18n/client-messages.ts`).toBeDefined();
      const misses: string[] = [];
      for (const file of clientModulesOf(entry)) {
        for (const path of requiredPaths(read(file))) {
          if (!covers(paths, path)) misses.push(`${relative(ROOT, file).replace(/\\/g, "/")} needs "${path}"`);
        }
      }
      expect(misses, `not in ${name}:\n  ${misses.join("\n  ")}`).toEqual([]);
    });
  }
});
