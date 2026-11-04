import { MUST_DOS_MAX, MUST_DO_MAX_LENGTH } from "@/lib/trips/request-limits";

/**
 * A typed wish as the server takes it: trimmed, without trailing commas, and
 * no longer than MUST_DO_MAX_LENGTH. The input's maxLength alone doesn't hold
 * the length: a phone keyboard's suggestions can write past it.
 */
export function mustDoItem(typed: string): string {
  return typed.trim().replace(/,+$/, "").slice(0, MUST_DO_MAX_LENGTH).trim();
}

/** The wishes with `item` added, unless it is there already (in any case) or the list is full. */
export function withMustDo(list: string[], item: string): string[] {
  return list.some((m) => m.toLowerCase() === item.toLowerCase()) || list.length >= MUST_DOS_MAX
    ? list
    : [...list, item];
}
