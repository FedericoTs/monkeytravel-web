"use client";

import RouteError, { type RouteErrorProps } from "@/components/RouteError";

export default function SharedTripError(props: RouteErrorProps) {
  return <RouteError {...props} errorType="shared-trip-error" messages="common.shared.loadError" tone="amber" />;
}
