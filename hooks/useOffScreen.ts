"use client";

import { useEffect, useState } from "react";

/**
 * Whether an element has left the screen. `ref` goes on the element.
 * `offScreen` is true once the browser reports it out of view; it is false
 * while the element is in view, not measured yet, or not there.
 */
export function useOffScreen<T extends Element>() {
  const [node, setNode] = useState<T | null>(null);
  // The element last reported out of view: a new one starts as in view.
  const [left, setLeft] = useState<T | null>(null);
  useEffect(() => {
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      const last = entries[entries.length - 1];
      if (last) setLeft(last.isIntersecting ? null : node);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);
  return { ref: setNode, offScreen: node !== null && left === node };
}
