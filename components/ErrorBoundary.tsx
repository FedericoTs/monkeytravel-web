"use client";

import { Component, type ReactNode } from "react";
import { reportBoundaryError } from "@/lib/observability/report-boundary-error";

interface ErrorBoundaryProps {
  /** Recorded as the `errorType` tag on the Sentry event, e.g. "shared-trip-map". */
  errorType: string;
  /** Rendered in place of the subtree once it has thrown. */
  fallback: ReactNode;
  children: ReactNode;
}

interface ErrorBoundaryState {
  failed: boolean;
}

/**
 * Contain a client-side throw to ONE widget instead of a whole route.
 *
 * WHY THIS EXISTS
 *
 * Sentry JAVASCRIPT-NEXTJS-26 / -27, same trace, same iOS 18.7 Safari session:
 * a visitor opened a shared trip, `@react-google-maps/api` constructed its map
 * against a ref that was not an Element, and the Polyline mounting into that
 * dead map threw out of componentDidMount.
 *
 * The only boundary on the route was app/[locale]/shared/[token]/error.tsx — a
 * ROUTE-level boundary — so a decorative map replaced the entire itinerary with
 * a full-screen "something went wrong". The visitor arrived from a friend's
 * share link and never saw the trip. /shared is the top of the acquisition
 * loop; it is the worst page in the app to lose to a widget.
 *
 * The map is not load-bearing on a read-only share page. Anything that isn't
 * should be allowed to fail alone. Reporting still goes through the same helper
 * the route boundaries use, so narrowing the blast radius costs no
 * observability — the Sentry event is unchanged apart from its errorType tag.
 *
 * This does NOT fix the underlying null-ref crash inside the Google Maps SDK,
 * which is not reproducible from the stack trace alone.
 */
export default class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error & { digest?: string }) {
    reportBoundaryError(error, this.props.errorType);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
