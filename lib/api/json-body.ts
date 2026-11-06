import type { NextResponse } from "next/server";
import { errors } from "./response-wrapper";

/**
 * The request's JSON body, or a 400 when the body isn't JSON or is JSON null,
 * whose first field read would throw. Awaiting request.json() inside a route's
 * catch-all answers a malformed body with a 500, as if the server had failed.
 *
 *   const { body, invalidBody } = await readJsonBody<CreateBody>(request);
 *   if (invalidBody) return invalidBody;
 *
 * The body is typed like request.json()'s (any) unless the route names it;
 * nothing here checks its shape.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the type request.json() gives
export async function readJsonBody<T = any>(
  request: Request,
): Promise<{ body: T; invalidBody: null } | { body: null; invalidBody: NextResponse }> {
  try {
    const body = (await request.json()) as T | null;
    if (body !== null) return { body, invalidBody: null };
  } catch {
    // Answered below, like a body of null.
  }
  return { body: null, invalidBody: errors.badRequest("Invalid JSON body") };
}
