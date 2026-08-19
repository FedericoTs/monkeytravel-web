/**
 * Stub for Next.js's `server-only` marker package.
 *
 * `lib/destinations/data.ts` imports "server-only" so the ~3k-line destination
 * dataset can never be pulled into a client bundle. That package has no real
 * module body outside a Next build, so importing the dataset from a vitest
 * suite fails to resolve. Aliased in vitest.config.ts; this file exists purely
 * to be an empty, resolvable module.
 */
export {};
