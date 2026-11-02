import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import type { TocItem } from "@/lib/blog/api";
import BlogContentClient from "./BlogContentClient";

const toc: TocItem[] = [
  { id: "antes-de-ir-lo-practico", text: "Antes de Ir: Lo Práctico", level: 2 },
  { id: "como-moverse", text: "Cómo Moverse", level: 3 },
  { id: "dia-1-los-iconos", text: "Día 1: Los Iconos", level: 2 },
  { id: "dia-2-arte", text: "Día 2: Arte", level: 2 },
];

describe("BlogContentClient", () => {
  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
  });

  it("lists the ToC it is given, not every heading in the article", () => {
    // The inline CTA box sits inside the article and has an <h3> of its own.
    document.body.innerHTML =
      '<article class="blog-prose"><h2 id="antes-de-ir-lo-practico">Antes de Ir: Lo Práctico</h2>' +
      "<div><h3>Sáltate la planificación, empieza el viaje</h3></div></article>";
    render(<BlogContentClient html="" toc={toc} tocLabel="Índice" />);

    fireEvent.click(screen.getByRole("button", { name: "Índice" }));

    const links = screen.getAllByRole("link").map((a) => [a.getAttribute("href"), a.textContent]);
    expect(links).toEqual(toc.map((item) => [`#${item.id}`, item.text]));
    expect(document.querySelector("article h3")!.id).toBe("");
  });

  it("is in the server-rendered HTML", () => {
    expect(renderToString(<BlogContentClient html="" toc={toc} tocLabel="Índice" />)).toContain("Índice");
  });

  it("renders nothing for an article with two sections or fewer", () => {
    const { container } = render(<BlogContentClient html="" toc={toc.slice(0, 3)} tocLabel="Índice" />);
    expect(container.innerHTML).toBe("");
  });
});
