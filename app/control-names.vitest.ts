// @vitest-environment node
import { describe, expect, it } from "vitest";
import { execFileSync } from "child_process";
import { readFileSync } from "fs";
import ts from "typescript";

/**
 * Every button and link can be named by a screen reader: one holding only an icon
 * is announced as "button" with nothing to say what it does. It takes an aria-label
 * (or title), or text a reader can see. So does every form field: an aria-label, or a
 * <label> around it or pointing at it. A placeholder is no name, since it goes away
 * when someone types, and a label beside a field that doesn't point at it names
 * nothing. Read from the source, so a new one is
 * caught here whichever page it is on. A spread of props, or a child this can't read,
 * gets the benefit of the doubt.
 */

const ICON = /Icon$|^(Check|X|Plus|Minus|Trash\d?|Pencil|Edit\d?|Share\d?|Copy|Menu|Search|Chevron\w*|Arrow\w*|Loader\d?|Spinner|More\w*|Heart|Star|Bell|Calendar|Map\w*|Clock|Sparkles|Send|Compass|Camera|Image|Settings|User\w*|RefreshCw|RotateCcw|Undo\d?|Redo\d?)$/;

const attribute = (el: ts.JsxOpeningLikeElement, name: string) =>
  el.attributes.properties.find((p) => ts.isJsxAttribute(p) && p.name.getText() === name);

function expressionMayHoldText(e: ts.Expression): boolean {
  if (ts.isParenthesizedExpression(e)) return expressionMayHoldText(e.expression);
  if (ts.isBinaryExpression(e)) {
    const op = e.operatorToken.kind;
    if (op === ts.SyntaxKind.AmpersandAmpersandToken) return expressionMayHoldText(e.right);
    if (op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken) {
      return expressionMayHoldText(e.left) || expressionMayHoldText(e.right);
    }
  }
  if (ts.isConditionalExpression(e)) return expressionMayHoldText(e.whenTrue) || expressionMayHoldText(e.whenFalse);
  if (ts.isJsxElement(e) || ts.isJsxSelfClosingElement(e) || ts.isJsxFragment(e)) return mayHoldText(e);
  return e.kind !== ts.SyntaxKind.NullKeyword;
}

function mayHoldText(node: ts.Node): boolean {
  if (ts.isJsxText(node)) return node.getText().trim().length > 0;
  if (ts.isJsxExpression(node)) return !!node.expression && expressionMayHoldText(node.expression);
  if (ts.isJsxSelfClosingElement(node)) {
    const tag = node.tagName.getText();
    if (/svg$/.test(tag) || tag === "img" || tag === "Image") return !!attribute(node, "alt");
    return !ICON.test(tag);
  }
  if (ts.isJsxElement(node)) {
    const tag = node.openingElement.tagName.getText();
    if (/svg$/.test(tag) || attribute(node.openingElement, "aria-hidden")) return false;
    return node.children.some(mayHoldText);
  }
  if (ts.isJsxFragment(node)) return node.children.some(mayHoldText);
  return false;
}

const attributeText = (el: ts.JsxOpeningLikeElement, name: string) => {
  const found = attribute(el, name);
  return found && ts.isJsxAttribute(found) ? found.initializer?.getText().replace(/^\{|\}$|["'`]/g, "") : undefined;
};

function unnamedControls(file: string, text: string): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const labelled = new Set<string>();
  const collectLabels = (node: ts.Node) => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText() === "label") {
      const target = attributeText(node, "htmlFor");
      if (target) labelled.add(target);
    }
    ts.forEachChild(node, collectLabels);
  };
  collectLabels(source);
  const lineOf = (node: ts.Node) => source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
  const visitField = (el: ts.JsxOpeningLikeElement, insideLabel: boolean) => {
    if (!["input", "textarea", "select"].includes(el.tagName.getText()) || insideLabel) return;
    const type = attributeText(el, "type");
    const id = attributeText(el, "id");
    const named =
      el.attributes.properties.some((p) => ts.isJsxSpreadAttribute(p)) ||
      type === "hidden" ||
      type === "file" ||
      ["aria-label", "aria-labelledby", "title"].some((a) => attribute(el, a)) ||
      (id !== undefined && labelled.has(id));
    if (!named) found.push(`${file}:${lineOf(el)}`);
  };
  const visit = (node: ts.Node, insideLabel: boolean) => {
    const inLabel = insideLabel || (ts.isJsxElement(node) && node.openingElement.tagName.getText() === "label");
    if (ts.isJsxElement(node)) visitField(node.openingElement, inLabel);
    if (ts.isJsxSelfClosingElement(node)) visitField(node, inLabel);
    if (ts.isJsxElement(node) && ["button", "a", "Link"].includes(node.openingElement.tagName.getText())) {
      const open = node.openingElement;
      const named =
        open.attributes.properties.some((p) => ts.isJsxSpreadAttribute(p)) ||
        ["aria-label", "aria-labelledby", "title"].some((a) => attribute(open, a)) ||
        node.children.some(mayHoldText);
      if (!named) found.push(`${file}:${lineOf(node)}`);
    }
    ts.forEachChild(node, (child) => visit(child, inLabel));
  };
  visit(source, false);
  return found;
}

describe("every button, link and form field has a name", () => {
  it("across the app", () => {
    const files = execFileSync("git", ["ls-files", "*.tsx"], { encoding: "utf8" })
      .split("\n")
      .filter((f) => f && !/vitest|\.spec\.|^tests\/|^video\//.test(f));
    expect(files.length).toBeGreaterThan(100);
    expect(files.flatMap((f) => unnamedControls(f, readFileSync(f, "utf8")))).toEqual([]);
  });

  const unnamed = (jsx: string) => unnamedControls("x.tsx", `const a = (${jsx});`).length > 0;

  it.each([
    ["an icon alone", `<button onClick={f}><X className="w-4" /></button>`],
    ["an svg alone", `<button><svg><path /></svg></button>`],
    ["a link holding only an icon", `<a href="/x"><svg /></a>`],
    ["a field with nothing", `<input value={v} />`],
    ["a field with only a placeholder", `<input placeholder="Name" />`],
    ["a select with nothing", `<select value={v}><option>A</option></select>`],
    ["a label beside a field, pointing at nothing", `<div><label>Name</label><input value={v} /></div>`],
    ["a label pointing at another field", `<div><label htmlFor="a">Name</label><input id="b" /></div>`],
    ["an icon either way", `<button>{open ? <ChevronUp /> : <ChevronDown />}</button>`],
    ["an icon sometimes", `<button>{done && <svg />}</button>`],
  ])("catches %s", (_name, jsx) => {
    expect(unnamed(jsx)).toBe(true);
  });

  it.each([
    ["an aria-label", `<button aria-label="Close"><X /></button>`],
    ["a field's aria-label", `<input aria-label="Name" />`],
    ["a field inside its label", `<label>Name <input value={v} /></label>`],
    ["a label pointing at its field", `<div><label htmlFor="a">Name</label><input id="a" /></div>`],
    ["a hidden field", `<input type="hidden" value={v} />`],
    ["a file field", `<input type="file" className="hidden" />`],
    ["a field's spread props", `<input {...field} />`],
    ["a title", `<button title="Close"><X /></button>`],
    ["text", `<button><X /> Close</button>`],
    ["a translated child", `<button>{t("close")}</button>`],
    ["text one way", `<button>{busy ? <Spinner /> : t("save")}</button>`],
    ["an image with alt text", `<a href="/x"><img alt="Home" /></a>`],
    ["spread props", `<button {...props}><X /></button>`],
    ["a child component that may render text", `<button><Label /></button>`],
  ])("accepts %s", (_name, jsx) => {
    expect(unnamed(jsx)).toBe(false);
  });
});
