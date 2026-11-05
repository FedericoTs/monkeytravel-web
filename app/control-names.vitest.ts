// @vitest-environment node
import { describe, expect, it } from "vitest";
import { execFileSync } from "child_process";
import { readFileSync } from "fs";
import ts from "typescript";

/**
 * Every button and link can be named by a screen reader: one holding only an icon
 * is announced as "button" with nothing to say what it does. It takes an aria-label
 * (or title), or text a reader can see. Read from the source, so a new one is caught
 * here whichever page it is on. A spread of props, or a child this can't read, gets
 * the benefit of the doubt.
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

function unnamedControls(file: string, text: string): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node) && ["button", "a", "Link"].includes(node.openingElement.tagName.getText())) {
      const open = node.openingElement;
      const named =
        open.attributes.properties.some((p) => ts.isJsxSpreadAttribute(p)) ||
        ["aria-label", "aria-labelledby", "title"].some((a) => attribute(open, a)) ||
        node.children.some(mayHoldText);
      if (!named) found.push(`${file}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe("every button and link has a name", () => {
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
    ["an icon either way", `<button>{open ? <ChevronUp /> : <ChevronDown />}</button>`],
    ["an icon sometimes", `<button>{done && <svg />}</button>`],
  ])("catches %s", (_name, jsx) => {
    expect(unnamed(jsx)).toBe(true);
  });

  it.each([
    ["an aria-label", `<button aria-label="Close"><X /></button>`],
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
