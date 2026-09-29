import type * as SentrySdk from "@sentry/nextjs";

type Sdk = typeof SentrySdk;
type Setup = (sentry: Sdk) => Promise<void> | void;
type Breadcrumb = Parameters<Sdk["addBreadcrumb"]>[0];
type User = Parameters<Sdk["setUser"]>[0];

let setup: Setup | null = null;
let sdk: Promise<Sdk> | null = null;
let ready: Promise<Sdk> | null = null;
let loaded: Sdk | null = null;
const pending: { breadcrumbs: Breadcrumb[]; user?: User } = { breadcrumbs: [] };

const report = (error: unknown) => {
  sentry()
    .then((Sentry) => Sentry.captureException(error))
    .catch(() => {});
};
const onEarlyError = (event: ErrorEvent) => report(event.error ?? new Error(event.message));
const onEarlyRejection = (event: PromiseRejectionEvent) => report(event.reason);

/**
 * Makes the SDK loadable on demand instead of shipping it with every page:
 * `init` runs once the SDK chunk has been fetched, and until then two window
 * hooks catch errors and rejections and hand them over after `init`. Called
 * once, from instrumentation-client.ts, in production only.
 */
export function configureSentry(init: Setup): void {
  setup = init;
  window.addEventListener("error", onEarlyError);
  window.addEventListener("unhandledrejection", onEarlyRejection);
}

/**
 * The initialised SDK, fetched on first use (about 150 KB, so only error
 * paths and consented session recording ask for it). Rejects where nothing
 * configured it: the server, development, tests.
 */
export function sentry(): Promise<Sdk> {
  if (!setup) return Promise.reject(new Error("Sentry not configured"));
  sdk ??= import("@sentry/nextjs").then((Sentry) => {
    ready = Promise.resolve(setup!(Sentry)).then(() => Sentry);
    loaded = Sentry;
    if (pending.user) Sentry.setUser(pending.user);
    for (const breadcrumb of pending.breadcrumbs) Sentry.addBreadcrumb(breadcrumb);
    pending.breadcrumbs = [];
    // The SDK's own handlers see everything from here on.
    window.removeEventListener("error", onEarlyError);
    window.removeEventListener("unhandledrejection", onEarlyRejection);
    return Sentry;
  });
  return sdk;
}

/** A breadcrumb for the trail behind a later error: kept (the last 30) until the SDK exists, never a reason to fetch it. */
export function sentryBreadcrumb(breadcrumb: Breadcrumb): void {
  if (loaded) {
    loaded.addBreadcrumb(breadcrumb);
  } else if (setup) {
    pending.breadcrumbs.push(breadcrumb);
    if (pending.breadcrumbs.length > 30) pending.breadcrumbs.shift();
  }
}

/** Who the visitor is, applied once the SDK exists; never a reason to fetch it. */
export function sentryUser(user: User): void {
  if (loaded) loaded.setUser(user);
  else pending.user = user;
}

/** The SDK once `init` has finished everything asynchronous, such as adding the replay recorder. */
export function sentryReady(): Promise<Sdk> {
  return sentry().then(() => ready!);
}
