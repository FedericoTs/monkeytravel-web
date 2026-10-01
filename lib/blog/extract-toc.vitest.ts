/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import { extractToc, getPostBySlug, slugifyHeading } from "./api";

/**
 * The renderer escapes "&" in headings as "&#x26;". The sidebar ToC and the
 * JSON-LD list printed it, and the ids were built from it while
 * BlogContentClient re-derives them from the decoded textContent, so after
 * hydration the sidebar's links to those headings went nowhere.
 */
describe("extractToc", () => {
  it("shows a heading's characters, not their entities", async () => {
    const post = await getPostBySlug("where-to-go-in-february", "en");
    const toc = extractToc(post!.html);
    const carnival = toc.find((item) => item.text.startsWith("1. Rio de Janeiro"));
    expect(carnival?.text).toBe("1. Rio de Janeiro & Salvador — Carnival");
    expect(toc.some((item) => /&#?\w+;/.test(item.text))).toBe(false);
  });

  it("gives every heading the id the browser derives from its text", async () => {
    const post = await getPostBySlug("where-to-go-in-february", "en");
    const toc = extractToc(post!.html);
    expect(toc.find((item) => item.text.startsWith("1. Rio de Janeiro"))?.id).toBe("1-rio-de-janeiro-salvador-carnival");
    for (const item of toc) {
      expect(item.id).toBe(slugifyHeading(item.text));
      expect(post!.html).toContain(`id="${item.id}"`);
    }
  });

  it("decodes named and numeric references, and leaves unknown ones", () => {
    const [item] = extractToc("<h2 id=\"x\">A &amp; B &#38; C &lt;D&gt; &#x27;E&#x27; &bogus;</h2>");
    expect(item.text).toBe("A & B & C <D> 'E' &bogus;");
  });
});
