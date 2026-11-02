/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import { getPostBySlug } from "./api";

const OPEN = '<div class="table-wrapper"><div class="table-wrapper-scroll"><table';

describe("post tables", () => {
  it("come wrapped for rounded corners and a horizontal scroll", async () => {
    const { html } = (await getPostBySlug("3-day-paris-itinerary", "en"))!;
    const tables = html.match(/<table[\s>]/g) ?? [];
    expect(tables.length).toBeGreaterThan(0);
    expect(html.split(OPEN).length - 1).toBe(tables.length);
    expect(html.split("</table></div></div>").length - 1).toBe(tables.length);
  });
});
