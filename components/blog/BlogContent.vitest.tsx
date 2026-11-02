import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import type { TocItem } from "@/lib/blog/api";
import BlogContent from "./BlogContent";

const toc: TocItem[] = [
  { id: "uno", text: "Uno", level: 2 },
  { id: "dos", text: "Dos", level: 2 },
  { id: "tres", text: "Tres", level: 2 },
];
const html = '<h2 id="uno">Uno</h2><p>Texto.</p><h2 id="dos">Dos</h2><p>Más.</p><h2 id="tres">Tres</h2>';

describe("BlogContent", () => {
  it("puts the collapsible ToC above the article, in the server HTML", () => {
    const out = renderToString(<BlogContent html={html} toc={toc} tocLabel="Índice" />);
    expect(out.indexOf("Índice")).toBeGreaterThan(-1);
    expect(out.indexOf("Índice")).toBeLessThan(out.indexOf("<article"));
  });
});
