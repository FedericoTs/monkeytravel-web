import { beforeAll, describe, expect, it } from "vitest";
import { survivePageTranslators } from "./survive-page-translators";

/** What a browser's page translator does: the text node leaves the page and a <font> takes its place. */
function translate(text: Text): HTMLElement {
  const font = document.createElement("font");
  font.textContent = "przetłumaczone";
  text.parentNode!.replaceChild(font, text);
  return font;
}

/** A translator that moves the text node into its wrapper instead. */
function wrap(text: Text): HTMLElement {
  const font = document.createElement("font");
  text.parentNode!.replaceChild(font, text);
  font.appendChild(text);
  return font;
}

function box(...children: Node[]): HTMLElement {
  const div = document.createElement("div");
  div.append(...children);
  return div;
}

const shape = (node: Node) => [...node.childNodes].map((child) => child.nodeName);

describe("survivePageTranslators", () => {
  beforeAll(() => survivePageTranslators());

  describe("removing", () => {
    it("removes a child as usual, and hands it back", () => {
      const text = document.createTextNode("Continue");
      const parent = box(text, document.createElement("b"));
      expect(parent.removeChild(text)).toBe(text);
      expect(shape(parent)).toEqual(["B"]);
    });

    it("does nothing to a text node the translator already took off the page", () => {
      const text = document.createTextNode("Continue");
      const parent = box(text);
      translate(text);
      expect(parent.removeChild(text)).toBe(text);
      expect(shape(parent)).toEqual(["FONT"]);
    });

    it("takes a node out of the wrapper it was moved into", () => {
      const text = document.createTextNode("Continue");
      const parent = box(text);
      const font = wrap(text);
      expect(parent.removeChild(text)).toBe(text);
      expect(text.parentNode).toBeNull();
      expect(font.childNodes).toHaveLength(0);
    });
  });

  describe("inserting", () => {
    it("goes before the reference as usual, and hands back the new node", () => {
      const first = document.createElement("i");
      const parent = box(first);
      const added = document.createElement("b");
      expect(parent.insertBefore(added, first)).toBe(added);
      expect(shape(parent)).toEqual(["B", "I"]);
    });

    it("goes at the end when there is no reference", () => {
      const parent = box(document.createElement("i"));
      parent.insertBefore(document.createElement("b"), null);
      expect(shape(parent)).toEqual(["I", "B"]);
    });

    it("still goes in when the translator took the reference off the page", () => {
      const text = document.createTextNode("Continue");
      const parent = box(document.createElement("i"), text);
      translate(text);
      const added = document.createElement("b");
      expect(parent.insertBefore(added, text)).toBe(added);
      expect(shape(parent)).toEqual(["I", "FONT", "B"]);
    });

    it("goes before the wrapper the reference was moved into", () => {
      const text = document.createTextNode("Continue");
      const parent = box(document.createElement("i"), text);
      wrap(text);
      parent.insertBefore(document.createElement("b"), text);
      expect(shape(parent)).toEqual(["I", "B", "FONT"]);
    });

    it("goes before a reference moved several wrappers down", () => {
      const text = document.createTextNode("Continue");
      const parent = box(text);
      wrap(text);
      wrap(text);
      parent.insertBefore(document.createElement("b"), text);
      expect(shape(parent)).toEqual(["B", "FONT"]);
    });
  });
});
