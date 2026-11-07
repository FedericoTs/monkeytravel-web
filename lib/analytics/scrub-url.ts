/**
 * Some page addresses work as keys: whoever has a shared-trip, invite, join or
 * feedback link, or a day link's signed key, can open what it points to. The
 * analytics tools get those addresses with the key replaced, so neither they
 * nor anyone reading them holds a working link.
 */

const TOKEN_PATHS = /\/(shared|invite|feedback)\/[^/?#]+/g;
const CODE_PATHS = /\/join\/[^/?#]+/g;
// Unsubscribe and invite tokens, sign-in codes, and the day link's signed and send keys.
const KEY_PARAMS = ["token", "code", "token_hash", "k", "s"];

export function scrubUrl(value: string): string {
  const hashAt = value.indexOf("#");
  const beforeHash = hashAt === -1 ? value : value.slice(0, hashAt);
  // A fragment with parameters (a sign-in return) goes; a plain anchor stays.
  const hash = hashAt === -1 || value.slice(hashAt).includes("=") ? "" : value.slice(hashAt);
  const queryAt = beforeHash.indexOf("?");
  const path = (queryAt === -1 ? beforeHash : beforeHash.slice(0, queryAt))
    .replace(TOKEN_PATHS, "/$1/:token")
    .replace(CODE_PATHS, "/join/:code");
  if (queryAt === -1) return path + hash;
  const rawQuery = beforeHash.slice(queryAt + 1);
  const params = new URLSearchParams(rawQuery);
  // Rebuilt only when a key is in it, so other queries keep their exact form.
  if (!KEY_PARAMS.some((name) => params.has(name))) return `${path}?${rawQuery}${hash}`;
  for (const name of KEY_PARAMS) params.delete(name);
  const query = params.toString();
  return path + (query ? `?${query}` : "") + hash;
}

const URL_KEY = /(url|pathname|referrer|href)$/i;

function scrubValues(values: Record<string, unknown> | undefined): void {
  if (!values) return;
  for (const [name, value] of Object.entries(values)) {
    if (typeof value === "string" && URL_KEY.test(name)) values[name] = scrubUrl(value);
  }
}

interface Capture {
  event: string;
  properties?: Record<string, unknown>;
  $set?: Record<string, unknown>;
  $set_once?: Record<string, unknown>;
}

/**
 * PostHog's before_send: every address on the event, on the person
 * properties it sets, and on a recording's page-change entries.
 */
export function scrubCapture<T extends Capture>(capture: T | null): T | null {
  if (!capture) return capture;
  scrubValues(capture.properties);
  scrubValues(capture.$set);
  scrubValues(capture.$set_once);
  const snapshots = capture.properties?.$snapshot_data;
  if (Array.isArray(snapshots)) {
    for (const entry of snapshots) {
      // rrweb's Meta entry (type 4) records the page address.
      if (entry && entry.type === 4 && entry.data && typeof entry.data.href === "string") {
        entry.data.href = scrubUrl(entry.data.href);
      }
    }
  }
  return capture;
}
