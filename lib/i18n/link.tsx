"use client";

import { useState, type ComponentProps } from "react";
import { NavigationLink } from "./navigation";

/**
 * The app's Link. It prefetches a page once someone shows they may open it
 * (pointer over it, keyboard focus, a touch), not whenever it scrolls into
 * view: every visible link used to fetch its page in the background, and
 * most were never opened. An explicit `prefetch` is passed through as is.
 */
export function Link({
  prefetch,
  onMouseEnter,
  onFocus,
  onTouchStart,
  ...props
}: ComponentProps<typeof NavigationLink>) {
  const [intent, setIntent] = useState(false);
  return (
    <NavigationLink
      {...props}
      prefetch={prefetch ?? (intent ? null : false)}
      onMouseEnter={(event) => {
        setIntent(true);
        onMouseEnter?.(event);
      }}
      onFocus={(event) => {
        setIntent(true);
        onFocus?.(event);
      }}
      onTouchStart={(event) => {
        setIntent(true);
        onTouchStart?.(event);
      }}
    />
  );
}
