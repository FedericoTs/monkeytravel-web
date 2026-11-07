import { after } from "next/server";

/**
 * Reports a server failure the code handled itself (a 5xx response, a refused
 * write), which the SDK's own error hooks never see because nothing throws.
 *
 * Inside a request it runs after the response is sent. Each kind is sent at
 * most once a minute per instance, so an outage shows up as an issue without
 * spending the event quota on every failed request. It never throws.
 */

export type FailureLevel = "error" | "warning";

const ONCE_PER_MS = 60_000;
const KINDS_KEPT = 500;
const lastSent = new Map<string, number>();

// One import shared by every report; a failed one is retried by the next.
let sdk: Promise<typeof import("@sentry/nextjs")> | undefined;
function loadSdk() {
  sdk ??= import("@sentry/nextjs").catch((error: unknown) => {
    sdk = undefined;
    throw error;
  });
  return sdk;
}

export function reportServerFailure(
  message: string,
  level: FailureLevel,
  fingerprint: string[],
  now: number = Date.now(),
): void {
  const kind = fingerprint.join("\u0000");
  const last = lastSent.get(kind);
  if (last !== undefined && now - last < ONCE_PER_MS) return;
  if (lastSent.size >= KINDS_KEPT) lastSent.clear();
  lastSent.set(kind, now);

  const send = async () => {
    try {
      const Sentry = await loadSdk();
      Sentry.captureMessage(message, { level, fingerprint });
      // The request's own flush has already run by the time this does.
      await Sentry.flush(2000);
    } catch {
      // Reporting never breaks the request.
    }
  };

  try {
    after(send);
  } catch {
    // Outside a request (a script, a test) there is nothing to wait for.
    void send();
  }
}
