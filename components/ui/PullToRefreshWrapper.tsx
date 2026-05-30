"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { usePullToRefresh } from "@/lib/hooks/usePullToRefresh";
import { PullToRefreshIndicator } from "@/components/ui/PullToRefreshIndicator";
import { hapticLight } from "@/lib/native/haptics";

/**
 * Drop-in pull-to-refresh for server-component pages.
 *
 * /trips uses usePullToRefresh + PullToRefreshIndicator directly because
 * it's already a client component with its own refresh logic. But /saved
 * and /explore are server components — they can't call hooks. This thin
 * wrapper bundles the hook + indicator + a default `router.refresh()`
 * handler into a single client island that mounts globally on the page.
 *
 * Mount once near the top of a server page:
 *
 *   <PullToRefreshWrapper />
 *
 * The wrapper's touch listeners are document-level, so positioning
 * doesn't matter for the gesture detection — only the indicator's
 * fixed-position spinner matters visually, and that lives in its own
 * portal-like absolute positioning at z-60.
 *
 * `router.refresh()` re-runs the server component + revalidates any
 * `fetch` calls. 600ms minimum so snappy networks don't flash the
 * spinner.
 */
export function PullToRefreshWrapper() {
  const router = useRouter();

  const handleRefresh = useCallback(async () => {
    hapticLight();
    router.refresh();
    // Empirical minimum so the spinner doesn't blink on/off on fast
    // network — matches the value used in TripsPageClient.
    await new Promise((resolve) => setTimeout(resolve, 600));
  }, [router]);

  const { isRefreshing, pullDistance } = usePullToRefresh(handleRefresh, {
    threshold: 80,
  });

  return (
    <PullToRefreshIndicator
      distance={pullDistance}
      isRefreshing={isRefreshing}
      threshold={80}
    />
  );
}
