/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { inlineScriptHashes, urlPathFor } from "../../scripts/csp-manifest.mjs";
import { hasStaticManifest, staticPageHashes } from "./csp-manifest";

const sha = (s: string) => `sha256-${createHash("sha256").update(s, "utf8").digest("base64")}`;

describe("inlineScriptHashes: exactly the scripts a browser would execute", () => {
  it("hashes inline JavaScript, in whatever type spelling Next emits", () => {
    const html = `<script>self.__next_f.push([1,"a"])</script><script type="text/javascript">b()</script><script type="module">c()</script>`;
    expect(inlineScriptHashes(html)).toEqual([sha('self.__next_f.push([1,"a"])'), sha("b()"), sha("c()")].sort());
  });

  it("skips external scripts, data blocks and empty tags", () => {
    const html =
      `<script src="/_next/static/chunks/x.js" async></script>` +
      `<script type="application/ld+json">{"@context":"https://schema.org"}</script>` +
      `<script type="application/json" id="__NEXT_DATA__">{}</script>` +
      `<script></script>`;
    expect(inlineScriptHashes(html)).toEqual([]);
  });

  it("hashes the exact bytes between the tags: whitespace and entities untouched", () => {
    const body = ` if (a < b) { x = "y" } \n`;
    expect(inlineScriptHashes(`<script>${body}</script>`)).toEqual([sha(body)]);
  });

  it("returns each hash once, sorted, so the header is stable", () => {
    const html = `<script>x()</script><script>x()</script><script>a()</script>`;
    expect(inlineScriptHashes(html)).toEqual([sha("a()"), sha("x()")].sort());
  });
});

describe("urlPathFor: the URL a prerendered route answers on", () => {
  it("strips the default locale, which carries no prefix (localePrefix: as-needed in lib/i18n/routing.ts)", () => {
    expect(urlPathFor("/en")).toBe("/");
    expect(urlPathFor("/en/blog/where-to-go")).toBe("/blog/where-to-go");
  });

  it("keeps every other locale's prefix", () => {
    expect(urlPathFor("/it")).toBe("/it");
    expect(urlPathFor("/it/blog/where-to-go")).toBe("/it/blog/where-to-go");
    // A path that merely starts with "en" is not the English prefix.
    expect(urlPathFor("/english-guide")).toBe("/english-guide");
  });
});

describe("staticPageHashes before the manifest is embedded", () => {
  it("treats every path as rendered per request", () => {
    expect(hasStaticManifest()).toBe(false);
    expect(staticPageHashes("/")).toBeUndefined();
    expect(staticPageHashes("/blog")).toBeUndefined();
  });
});
