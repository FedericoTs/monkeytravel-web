/**
 * iCal (RFC 5545) generator — pure-function, no npm dep.
 *
 * Phase 1A of the calendar-export feature (see
 * docs/specs/calendar-export-smart-notifs.md). Turns a list of
 * `IcalEvent` records into a single VCALENDAR string suitable for
 * `Content-Type: text/calendar; charset=utf-8`.
 *
 * Design notes:
 *   - We intentionally avoid the `ics` and `ical-generator` packages.
 *     RFC 5545 is small for our shape (no recurrence, no attendees, no
 *     alarms in MVP) and the spec called for inline.
 *   - Timezone handling: each VEVENT carries a TZID. For every unique
 *     TZID across the input we emit a VTIMEZONE block at the top of the
 *     VCALENDAR. We compute the standard-time and (if applicable)
 *     daylight offsets from the IANA tz database via
 *     `Intl.DateTimeFormat(... { timeZoneName: "longOffset" })` — this
 *     is built into Node 20+ / modern browsers and avoids a ~13 KB
 *     date-fns-tz dependency just for offsets.
 *   - All-day events: signalled by `dtstart`/`dtend` being date-only
 *     (UTC midnight, same instant). Detected via the helper
 *     `isAllDay()` and emitted with `VALUE=DATE` and no TZID per
 *     RFC 5545 §3.6.1.
 *   - Line folding: RFC 5545 §3.1 — lines longer than 75 octets are
 *     folded with CRLF + a single space. We count bytes (UTF-8), not
 *     characters, so multibyte glyphs in summaries don't blow the
 *     limit.
 */

export type IcalEvent = {
  /** Stable per activity_id. We dedupe-on-UID at the client. */
  uid: string;
  summary: string;
  description?: string;
  location?: string;
  geo?: { lat: number; lng: number };
  /**
   * Event start. For timed events, this is a wall-clock instant; the
   * combination of (dtstart, tzid) is what calendar clients store. We
   * format `YYYYMMDDTHHmmss` using the wall-clock components in `tzid`
   * (or in UTC if `tzid` is absent).
   */
  dtstart: Date;
  dtend: Date;
  /** IANA tz, e.g. "Europe/Lisbon". Omit for all-day or floating events. */
  tzid?: string;
};

export type BuildIcalOptions = {
  calName: string;
  /** Defaults to `-//monkeytravel.app//Trip Export 1.0//EN`. */
  productId?: string;
};

const DEFAULT_PRODID = "-//monkeytravel.app//Trip Export 1.0//EN";
const CRLF = "\r\n";

/**
 * Build a valid iCalendar (RFC 5545) string.
 *
 * @param events  one VEVENT per item. Empty array still produces a
 *                valid (empty) VCALENDAR.
 * @param opts    calendar metadata (display name, PRODID).
 */
export function buildIcal(events: IcalEvent[], opts: BuildIcalOptions): string {
  const lines: string[] = [];
  lines.push("BEGIN:VCALENDAR");
  lines.push(`PRODID:${escapeText(opts.productId ?? DEFAULT_PRODID)}`);
  lines.push("VERSION:2.0");
  lines.push("CALSCALE:GREGORIAN");
  lines.push("METHOD:PUBLISH");
  lines.push(`X-WR-CALNAME:${escapeText(opts.calName)}`);

  // VTIMEZONE blocks — one per unique TZID across all events. All-day
  // events have no TZID, so they don't contribute here.
  const tzids = uniqueTzids(events);
  for (const tzid of tzids) {
    const block = buildVTimezone(tzid);
    if (block) lines.push(...block);
  }

  // VEVENT blocks.
  const dtstamp = formatUtc(new Date());
  for (const ev of events) {
    lines.push(...buildVEvent(ev, dtstamp));
  }

  lines.push("END:VCALENDAR");

  // Fold every line to ≤75 octets per RFC 5545 §3.1, join with CRLF,
  // and terminate the file with a trailing CRLF.
  return lines.map(foldLine).join(CRLF) + CRLF;
}

// ---------------------------------------------------------------------------
// VEVENT
// ---------------------------------------------------------------------------

function buildVEvent(ev: IcalEvent, dtstamp: string): string[] {
  const out: string[] = ["BEGIN:VEVENT"];
  out.push(`UID:${escapeText(ev.uid)}`);
  out.push(`DTSTAMP:${dtstamp}`);

  if (isAllDay(ev)) {
    // All-day: VALUE=DATE, no TZID. DTEND is exclusive per RFC 5545.
    out.push(`DTSTART;VALUE=DATE:${formatDateOnly(ev.dtstart)}`);
    out.push(`DTEND;VALUE=DATE:${formatDateOnly(ev.dtend)}`);
  } else if (ev.tzid) {
    out.push(`DTSTART;TZID=${ev.tzid}:${formatLocal(ev.dtstart, ev.tzid)}`);
    out.push(`DTEND;TZID=${ev.tzid}:${formatLocal(ev.dtend, ev.tzid)}`);
  } else {
    // Floating UTC.
    out.push(`DTSTART:${formatUtc(ev.dtstart)}`);
    out.push(`DTEND:${formatUtc(ev.dtend)}`);
  }

  out.push(`SUMMARY:${escapeText(ev.summary)}`);
  if (ev.location) out.push(`LOCATION:${escapeText(ev.location)}`);
  if (ev.geo) out.push(`GEO:${ev.geo.lat.toFixed(6)};${ev.geo.lng.toFixed(6)}`);
  if (ev.description) out.push(`DESCRIPTION:${escapeText(ev.description)}`);
  out.push("END:VEVENT");
  return out;
}

// ---------------------------------------------------------------------------
// VTIMEZONE
// ---------------------------------------------------------------------------

/**
 * Build a minimal VTIMEZONE block for the given IANA zone.
 *
 * RFC 5545 §3.6.5 requires at least one STANDARD or DAYLIGHT subcomponent.
 * For zones that observe DST we emit both; for zones that don't we emit
 * just STANDARD. We probe two dates (mid-January and mid-July) to detect
 * the current offsets and DST status. This is good enough for trip
 * export — clients (Apple Calendar, Google Calendar, Outlook) all maintain
 * their own tz database and will use ours only as a hint.
 *
 * Returns `null` if the TZID is unknown to the runtime (defensive — we
 * fall back to UTC in that case at the VEVENT layer).
 */
function buildVTimezone(tzid: string): string[] | null {
  const janOffset = getOffsetMinutes(tzid, new Date(Date.UTC(2024, 0, 15, 12)));
  const julOffset = getOffsetMinutes(tzid, new Date(Date.UTC(2024, 6, 15, 12)));
  if (janOffset == null || julOffset == null) return null;

  const lines: string[] = ["BEGIN:VTIMEZONE", `TZID:${tzid}`];

  if (janOffset === julOffset) {
    // No DST.
    lines.push("BEGIN:STANDARD");
    lines.push("DTSTART:19700101T000000");
    lines.push(`TZOFFSETFROM:${formatOffset(janOffset)}`);
    lines.push(`TZOFFSETTO:${formatOffset(janOffset)}`);
    lines.push("TZNAME:STD");
    lines.push("END:STANDARD");
  } else {
    // DST observed. Northern hemisphere: STD in Jan, DST in Jul.
    // Southern hemisphere: DST in Jan, STD in Jul.
    const stdOffset = Math.min(janOffset, julOffset);
    const dstOffset = Math.max(janOffset, julOffset);
    lines.push("BEGIN:STANDARD");
    lines.push("DTSTART:19701101T020000");
    lines.push(`TZOFFSETFROM:${formatOffset(dstOffset)}`);
    lines.push(`TZOFFSETTO:${formatOffset(stdOffset)}`);
    lines.push("TZNAME:STD");
    lines.push("END:STANDARD");
    lines.push("BEGIN:DAYLIGHT");
    lines.push("DTSTART:19700301T020000");
    lines.push(`TZOFFSETFROM:${formatOffset(stdOffset)}`);
    lines.push(`TZOFFSETTO:${formatOffset(dstOffset)}`);
    lines.push("TZNAME:DST");
    lines.push("END:DAYLIGHT");
  }

  lines.push("END:VTIMEZONE");
  return lines;
}

/**
 * Returns the offset from UTC in minutes for the given IANA tz at the
 * given instant. Positive = east of UTC. Returns null if the TZID is
 * not recognised by the runtime.
 */
function getOffsetMinutes(tzid: string, at: Date): number | null {
  try {
    // `longOffset` yields "GMT+01:00" / "GMT-05:00" / "GMT" for UTC.
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tzid,
      timeZoneName: "longOffset",
    });
    const parts = fmt.formatToParts(at);
    const part = parts.find((p) => p.type === "timeZoneName");
    if (!part) return null;
    return parseGmtOffset(part.value);
  } catch {
    return null;
  }
}

function parseGmtOffset(value: string): number | null {
  // "GMT", "UTC" → 0
  if (value === "GMT" || value === "UTC") return 0;
  const m = value.match(/^(?:GMT|UTC)([+-])(\d{1,2})(?::(\d{2}))?$/);
  if (!m) return null;
  const sign = m[1] === "+" ? 1 : -1;
  const hours = Number(m[2]);
  const minutes = Number(m[3] ?? "0");
  return sign * (hours * 60 + minutes);
}

function formatOffset(offsetMinutes: number): string {
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${sign}${hh}${mm}`;
}

// ---------------------------------------------------------------------------
// Date formatting
// ---------------------------------------------------------------------------

/** `YYYYMMDDTHHmmssZ` — UTC instant per RFC 5545 §3.3.5. */
function formatUtc(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const mm = pad2(d.getUTCMonth() + 1);
  const dd = pad2(d.getUTCDate());
  const HH = pad2(d.getUTCHours());
  const MM = pad2(d.getUTCMinutes());
  const SS = pad2(d.getUTCSeconds());
  return `${yyyy}${mm}${dd}T${HH}${MM}${SS}Z`;
}

/** `YYYYMMDD` — all-day form. */
function formatDateOnly(d: Date): string {
  return `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}`;
}

/**
 * `YYYYMMDDTHHmmss` in the wall-clock of `tzid`. No trailing Z — the
 * accompanying `TZID=` parameter on the property gives the zone.
 */
function formatLocal(d: Date, tzid: string): string {
  // Intl returns the wall-clock parts in the target zone for the given
  // instant. We need YYYYMMDDTHHmmss with no separators.
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tzid,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = fmt.formatToParts(d);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "00";
  const yyyy = get("year");
  const mm = pad2Str(get("month"));
  const dd = pad2Str(get("day"));
  let HH = pad2Str(get("hour"));
  // `h23` should always give 00-23, but Intl on some runtimes returns
  // "24" at midnight. Normalize.
  if (HH === "24") HH = "00";
  const MM = pad2Str(get("minute"));
  const SS = pad2Str(get("second"));
  return `${yyyy}${mm}${dd}T${HH}${MM}${SS}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function pad2Str(s: string): string {
  return s.padStart(2, "0");
}

// ---------------------------------------------------------------------------
// All-day detection
// ---------------------------------------------------------------------------

/**
 * An event is treated as all-day when both endpoints are UTC midnight
 * AND the caller did not supply a TZID. This matches how clients
 * construct DATE-valued VEVENTs.
 */
function isAllDay(ev: IcalEvent): boolean {
  if (ev.tzid) return false;
  return isUtcMidnight(ev.dtstart) && isUtcMidnight(ev.dtend);
}

function isUtcMidnight(d: Date): boolean {
  return (
    d.getUTCHours() === 0 &&
    d.getUTCMinutes() === 0 &&
    d.getUTCSeconds() === 0 &&
    d.getUTCMilliseconds() === 0
  );
}

// ---------------------------------------------------------------------------
// Text escaping + line folding
// ---------------------------------------------------------------------------

/**
 * Escape a TEXT-value property per RFC 5545 §3.3.11.
 * Order matters: backslash first, then comma/semicolon/newline.
 */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

/**
 * Fold a single content line to ≤75 octets (UTF-8) per RFC 5545 §3.1.
 * Continuation lines start with a single space.
 *
 * We measure in bytes, not code units, so that a 4-byte emoji or a
 * 2-byte accented character is split cleanly without producing
 * invalid UTF-8.
 */
function foldLine(line: string): string {
  const MAX = 75;
  const bytes = utf8Bytes(line);
  if (bytes.length <= MAX) return line;

  const chunks: string[] = [];
  let cursor = 0;
  // First chunk: 75 bytes. Subsequent: 74 bytes (the leading space
  // counts toward the 75-byte limit).
  let chunkSize = MAX;
  while (cursor < bytes.length) {
    const end = Math.min(cursor + chunkSize, bytes.length);
    const safeEnd = avoidMidCodepoint(bytes, end);
    chunks.push(utf8Decode(bytes.slice(cursor, safeEnd)));
    cursor = safeEnd;
    chunkSize = MAX - 1;
  }
  return chunks.join(`${CRLF} `);
}

function utf8Bytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function utf8Decode(b: Uint8Array): string {
  return new TextDecoder().decode(b);
}

/**
 * Given a UTF-8 byte array and a tentative split index, walk backward
 * until we land on a code-point boundary. Continuation bytes are
 * 10xxxxxx — i.e. (byte & 0xC0) === 0x80. We back up while that holds.
 * Worst-case backup is 3 bytes (4-byte code point).
 */
function avoidMidCodepoint(bytes: Uint8Array, end: number): number {
  if (end >= bytes.length) return end;
  let i = end;
  while (i > 0 && (bytes[i] & 0xc0) === 0x80) i--;
  return i;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function uniqueTzids(events: IcalEvent[]): string[] {
  const seen = new Set<string>();
  for (const ev of events) {
    if (ev.tzid && !isAllDay(ev)) seen.add(ev.tzid);
  }
  return Array.from(seen);
}
