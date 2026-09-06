// tz-lookup ships no types. It exports a single function: (lat, lng) -> IANA
// timezone string, throwing on out-of-range coordinates. Server-only use
// (lib/trip/timezone.ts) — the ~150KB coordinate table must not reach the client.
declare module "tz-lookup" {
  export default function tzlookup(latitude: number, longitude: number): string;
}
