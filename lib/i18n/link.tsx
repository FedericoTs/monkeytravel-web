"use client";

import { useRef, useState, type ComponentProps } from "react";
import { startNavigationCue } from "@/lib/navigation-cue";
import { NavigationLink } from "./navigation";

/**
 * The app's Link. It prefetches a page once someone shows they may open it
 * (pointer over it, keyboard focus, a touch), not whenever it scrolls into
 * view: every visible link used to fetch its page in the background, and
 * most were never opened. An explicit `prefetch` is passed through as is.
 *
 * It also starts the bar that shows a tap has opened another page
 * (components/NavigationCue.tsx), when next/link navigates: not for a new tab,
 * nor a click a handler stopped.
 */
export function Link({
  prefetch,
  onMouseEnter,
  onFocus,
  onTouchStart,
  onClick,
  onNavigate,
  ...props
}: ComponentProps<typeof NavigationLink>) {
  const [intent, setIntent] = useState(false);
  // The address the click asked for. onNavigate, called next and only when the
  // page really changes, has no address of its own.
  const target = useRef<string | null>(null);
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
      onClick={(event) => {
        target.current = event.currentTarget.href;
        onClick?.(event);
      }}
      onNavigate={(event) => {
        let stopped = false;
        onNavigate?.({
          preventDefault: () => {
            stopped = true;
            event.preventDefault();
          },
        });
        if (!stopped) startNavigationCue(target.current);
      }}
    />
  );
}
