/**
 * The id the wizard sends with each generation request. The server keeps the
 * finished plan under it for a while (lib/ai/generation-result.ts), and logs it
 * with the request (api_request_logs.request_params.generation_id), so a
 * browser that lost the response can still collect the plan, and a failure on
 * the client joins to the server's row. Client-safe.
 */

export const GENERATION_ID_HEADER = "x-generation-id";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isGenerationId(value: string | null | undefined): value is string {
  return !!value && UUID.test(value);
}

/** A random (v4) id for one generation request. */
export function newGenerationId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // Browsers without randomUUID (or outside a secure context).
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
