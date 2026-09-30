/**
 * Whether this deployment may write a session-keyed analytics row.
 *
 * Local dev, Vercel previews and the CI e2e build all talk to the production
 * database, and none of them mints a session (lib/supabase/middleware.ts), so
 * their wizard, funnel and consent events used to land in production as
 * "no_session" rows mixed with real visitors. Outside production only a
 * session explicitly tagged as a probe is written, so probes stay deletable.
 */
export const PROBE_SESSION_PREFIX = "e2eprobe-";

export function writesTelemetry(sessionId: string | null | undefined): boolean {
  return process.env.VERCEL_ENV === "production" || (sessionId ?? "").startsWith(PROBE_SESSION_PREFIX);
}
