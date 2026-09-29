/**
 * The browser SDK is initialised at idle by instrumentation-client.ts. Every
 * other module reaches it through this import, so nothing puts the SDK into
 * a page's first bundle; a call made before it has loaded runs once it has.
 */
export const sentry = () => import("@sentry/nextjs");
