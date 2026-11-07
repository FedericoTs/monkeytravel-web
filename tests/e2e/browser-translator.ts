/**
 * What a browser's translator does to a page. It takes each text node off the
 * page and puts a <font> in its place, on the page as it is and on whatever is
 * added later; this does the same and keeps the words, so a test can still find
 * what it's looking for. Runs in the page: pass it to page.evaluate.
 */
export function translator() {
  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "OPTION", "FONT"]);
  const sweep = () => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const found: Text[] = [];
    while (walker.nextNode()) found.push(walker.currentNode as Text);
    for (const text of found) {
      const parent = text.parentNode;
      if (!parent || SKIP.has(parent.nodeName) || !text.nodeValue?.trim()) continue;
      const outer = document.createElement("font");
      const inner = document.createElement("font");
      inner.textContent = text.nodeValue;
      outer.appendChild(inner);
      parent.replaceChild(outer, text);
    }
  };
  let timer = 0;
  new MutationObserver(() => {
    clearTimeout(timer);
    timer = window.setTimeout(sweep, 50);
  }).observe(document.body, { childList: true, subtree: true });
  sweep();
}
