"use client";

import { formatDuration } from "@/lib/datetime/duration";

/** The lengths a stop can be given, from a quick look to a day out. */
const LENGTHS = [15, 30, 45, 60, 90, 120, 150, 180, 240, 300, 360, 480];

/**
 * A stop's length, picked from a list in hours and minutes, as its card shows
 * it. The stop's own length is on the list even when it isn't a usual one; a
 * stop without one starts on a blank, to pick from.
 */
export default function DurationSelect({
  value,
  onChange,
  label,
  className,
}: {
  value: number;
  onChange: (minutes: number) => void;
  label: string;
  className?: string;
}) {
  const own = Number.isFinite(value) && value > 0 ? value : null;
  const lengths = own === null || LENGTHS.includes(own) ? LENGTHS : [...LENGTHS, own].sort((a, b) => a - b);
  return (
    <select aria-label={label} value={own ?? ""} onChange={(e) => onChange(Number(e.target.value))} className={className}>
      {own === null && (
        <option value="" disabled>
          —
        </option>
      )}
      {lengths.map((minutes) => (
        <option key={minutes} value={minutes}>
          {formatDuration(minutes)}
        </option>
      ))}
    </select>
  );
}
