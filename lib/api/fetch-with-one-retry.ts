/**
 * fetch, tried a second time after a 250 ms pause when the first attempt
 * throws or answers 5xx. Image upstreams (Google's Places media endpoint, the
 * photo CDNs) return an occasional 503/504 that succeeds moments later; a 4xx
 * is a real answer and comes back at once. The failed response's body is
 * drained first so its connection can be reused.
 */
export async function fetchWithOneRetry(url: string, init: RequestInit): Promise<Response> {
  try {
    const res = await fetch(url, init);
    if (res.status < 500 || res.status > 599) return res;
    await res.arrayBuffer().catch(() => {});
  } catch {
    // A network error gets the same second try.
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
  return fetch(url, init);
}
