/**
 * Keeps React running on a page the browser is translating.
 *
 * Page translators take each text node off the page and put a <font> with the
 * translation in its place. React still holds the old node, so the next time it
 * removes that node, or inserts something before it, the DOM throws NotFoundError
 * and the error boundary replaces the whole page.
 * https://github.com/facebook/react/issues/11538
 *
 * These two make the same calls forgiving: what's already gone stays gone, and
 * what's new always goes in. Text React updates in place can stay in the old
 * translation, which is a smaller harm than losing the page.
 */
export function survivePageTranslators(): void {
  const { removeChild, insertBefore } = Node.prototype;

  Node.prototype.removeChild = function <T extends Node>(child: T): T {
    if (child.parentNode) removeChild.call(child.parentNode, child);
    return child;
  };

  Node.prototype.insertBefore = function <T extends Node>(this: Node, node: T, before: Node | null): T {
    // The wrapper the reference went into, or the end when it left the page.
    let anchor = before;
    while (anchor && anchor.parentNode !== this) anchor = anchor.parentNode;
    return insertBefore.call(this, node, anchor) as T;
  };
}
