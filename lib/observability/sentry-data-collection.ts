import type { init } from "@sentry/nextjs";

type DataCollection = NonNullable<NonNullable<Parameters<typeof init>[0]>["dataCollection"]>;

/**
 * What Sentry may send besides the error itself, in every runtime. The SDK
 * collects all of these by default; here it keeps what tells one browser or
 * page from another, and nothing about the person: no user fields, cookies,
 * other headers, bodies, local variables, or AI and database payloads.
 */
export const SENTRY_DATA_COLLECTION: DataCollection = {
  userInfo: false,
  cookies: false,
  httpHeaders: { allow: ["user-agent", "referer"] },
  httpBodies: [],
  urlQueryParams: true,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  mcp: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
};
