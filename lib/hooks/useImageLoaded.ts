import { useState, useEffect, type RefObject, type Dispatch, type SetStateAction } from "react";

/**
 * useImageLoaded — cached-image race shim.
 *
 * The naive `useState(false) + onLoad → setLoaded(true)` pattern has a
 * silent bug: when the browser already has the image in its HTTP cache,
 * the <img>'s `load` event NEVER fires after React mounts. The element
 * is `complete` with the bytes already decoded, but the state stays at
 * `false` and the image renders at `opacity:0` forever.
 *
 * This bites repeat visitors hardest (everything's cached) and was the
 * root cause of "all my trip covers are blank" complaints — caught via
 * live audit 2026-05-28 on /it/trips.
 *
 * This hook resolves it by:
 *   - Starting `loaded=true` when a `src` is already present on mount
 *     (assume the <img> will resolve from cache in the same frame).
 *   - Re-running on every `src` change: inspect the ref synchronously
 *     and flip back to `false` only if the browser doesn't already have
 *     the new src.
 *
 * Usage:
 *   const imgRef = useRef<HTMLImageElement | null>(null);
 *   const [loaded, setLoaded] = useImageLoaded(imgRef, src);
 *
 *   <img ref={imgRef} src={src}
 *        onLoad={() => setLoaded(true)}
 *        onError={() => setLoaded(false)}
 *        className={loaded ? "opacity-100" : "opacity-0"} />
 *
 * Note: `loaded === true` means "render the image at full opacity".
 * If the component also tracks an `error` state, AND the two together.
 */
export function useImageLoaded(
  ref: RefObject<HTMLImageElement | null>,
  src: string | null | undefined,
): [boolean, Dispatch<SetStateAction<boolean>>] {
  // Initial state: eager-true when we have a src. Lazy fetches that
  // arrive later (src goes null → string) will flip to false in the
  // effect below and let onLoad re-flip to true.
  const [loaded, setLoaded] = useState<boolean>(Boolean(src));

  useEffect(() => {
    if (!src) {
      setLoaded(false);
      return;
    }
    const img = ref.current;
    if (img && img.complete && img.naturalWidth > 0) {
      // Browser already had it in cache — onLoad won't fire.
      setLoaded(true);
    } else {
      // Fresh src — wait for onLoad. Skeleton shows in the interim.
      setLoaded(false);
    }
  }, [src, ref]);

  return [loaded, setLoaded];
}
