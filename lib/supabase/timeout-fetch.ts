/**
 * The longest a server-side call to Supabase may wait. Far past any healthy call
 * and far short of a function's own limit, so a database that stops answering
 * fails the request instead of hanging it until the platform kills it.
 */
const SUPABASE_TIMEOUT_MS = 30_000;

export const timeoutFetch: typeof fetch = async (input, init) => {
  const timeout = AbortSignal.timeout(SUPABASE_TIMEOUT_MS);
  try {
    return await fetch(input, {
      ...init,
      signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
    });
  } catch (err) {
    // Reported as an abort, which the client doesn't retry: it retries a read
    // after any other failure, and waiting again only multiplies the wait.
    if (timeout.aborted) throw new DOMException(`No answer from Supabase in ${SUPABASE_TIMEOUT_MS} ms`, "AbortError");
    throw err;
  }
};
