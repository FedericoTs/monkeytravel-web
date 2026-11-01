import { useState, useEffect, useRef, type RefObject, type Dispatch, type SetStateAction } from "react";

/**
 * useImageLoaded — cached-image race shim.
 *
 * Background:
 *
 * The naive `useState(false) + onLoad → setLoaded(true)` pattern has a
 * silent bug: when the browser already has the image in its HTTP cache,
 * the <img>'s `load` event NEVER fires after React mounts. The element
 * is `complete` with the bytes already decoded, but the state stays at
 * `false` and the image renders at `opacity:0` forever.
 *
 * 2026-05-31 (Day-12) revision — second-order bug found via user report:
 *
 * The previous fix used `useState(Boolean(src))` (eager-true on first
 * mount) but then the effect ALWAYS evaluated `img.complete` and called
 * `setLoaded(false)` when it wasn't. Problem: on first mount with a
 * fresh src, the <img> exists but has not yet started loading, so
 * `img.complete === false`. The effect runs immediately after commit
 * and clobbers the eager-true to false. If `onLoad` fired in the same
 * microtask BEFORE this effect ran (cached image with no network round
 * trip, or React 19 render scheduling reorder), the onLoad → true →
 * effect → false sequence ended at `false`. The image was fully decoded
 * but rendered at opacity:0 until the user refreshed the page.
 *
 * New approach:
 *
 *   - Initial state: eager-true when src is present.
 *   - Effect ONLY confirms-positively (`setLoaded(true)` if the ref
 *     reports `complete + naturalWidth > 0`). It NEVER flips back to
 *     false from this synchronous check — let `onLoad`/`onError` be the
 *     source of truth for state transitions.
 *   - On a NEW src (src changes after mount), reset to eager-true again
 *     and let the new <img>'s onLoad / onError correct it. We use a ref
 *     to distinguish "first run with initial src" from "src changed",
 *     avoiding a false reset on every render where the parent passes
 *     the same src.
 *   - On `src` going null, snap to false (no image to wait for).
 *
 * Tradeoff: an image that fails very slowly (>1s) is briefly shown at
 * opacity:1 before bytes arrive. That's fine — the browser renders the
 * progressive bytes as they arrive; users see image-arriving-into-place
 * rather than an opaque-then-fade-in. The previous fade-in was a nicety
 * that was costing us a real bug.
 *
 * Usage (unchanged):
 *   const imgRef = useRef<HTMLImageElement | null>(null);
 *   const [loaded, setLoaded] = useImageLoaded(imgRef, src);
 *
 *   <img ref={imgRef} src={src}
 *        onLoad={() => setLoaded(true)}
 *        onError={() => setLoaded(false)}
 *        className={loaded ? "opacity-100" : "opacity-0"} />
 */
export function useImageLoaded(
  ref: RefObject<HTMLImageElement | null>,
  src: string | null | undefined,
): [boolean, Dispatch<SetStateAction<boolean>>] {
  // Eager-true when we have a src. The browser starts loading the image
  // immediately when the element commits; we render at full opacity so
  // it appears as soon as the first bytes paint.
  const [loaded, setLoaded] = useState<boolean>(Boolean(src));
  // Track the previous src so we can detect a TRUE src change vs an
  // identity re-render that happens to call the hook again with the
  // same src (parent re-renders, sibling state updates, etc.).
  const lastSrc = useRef<string | null | undefined>(src);

  useEffect(() => {
    // No src → no image to wait for.
    if (!src) {
      lastSrc.current = src;
      setLoaded(false);
      return;
    }

    const srcChanged = src !== lastSrc.current;
    lastSrc.current = src;

    if (srcChanged) {
      // A new image was passed in. Reset to eager-true so the fresh
      // <img>'s onLoad / onError can be the source of truth. If the
      // browser already has THIS new src cached (preloaded earlier
      // on the page, e.g.), we confirm via the synchronous check below.
      setLoaded(true);
    }

    // Synchronous confirmation: if the <img> element already has the
    // bytes (cache hit, no network round trip), onLoad won't fire and
    // we need to assert true ourselves.
    const img = ref.current;
    if (img && img.complete && img.naturalWidth > 0) {
      setLoaded(true);
    }
    // IMPORTANT: do NOT call setLoaded(false) here. If the image hasn't
    // arrived yet, the eager-true state lets the browser paint progress
    // as bytes arrive. If the load truly fails, `onError` on the <img>
    // will fire and the consumer flips to false. This avoids the race
    // where the effect flips true→false right before onLoad would have
    // re-flipped it, leaving the image stuck at opacity:0.
  }, [src, ref]);

  return [loaded, setLoaded];
}
