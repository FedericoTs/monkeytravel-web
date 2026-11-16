"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { onNavigationStart } from "@/lib/navigation-cue";

const GIVE_UP_MS = 10_000;

/**
 * A thin bar along the top of the screen, from the tap that opens another page
 * until the address changes: without it nothing moves until the server has
 * answered. Decoration only: hidden from screen readers, which announce the new
 * page anyway, and still for those who ask for less motion (app/globals.css).
 */
export default function NavigationCue() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  // A new address is a new page: the bar starts over, off.
  return <Bar key={`${pathname}?${search}`} />;
}

function Bar() {
  const [running, setRunning] = useState(false);
  useEffect(() => onNavigationStart(() => setRunning(true)), []);
  // A navigation that never lands (an error, a tap undone) doesn't leave it up.
  useEffect(() => {
    if (!running) return;
    const timer = window.setTimeout(() => setRunning(false), GIVE_UP_MS);
    return () => window.clearTimeout(timer);
  }, [running]);
  if (!running) return null;
  return (
    <div aria-hidden="true" data-testid="navigation-cue" className="pointer-events-none fixed inset-x-0 top-0 z-[10000] h-[3px]">
      <div className="navigation-cue h-full bg-[var(--primary)]" />
    </div>
  );
}
