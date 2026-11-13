/**
 * Whether a request comes from a phone, by what the browser says of itself:
 * the mobile client hint where it is sent, else the user agent's own "Mobile"
 * (a tablet doesn't say it). It picks a page's first layout, which the page
 * can still change; it is never a gate.
 */
export function isPhoneRequest(headers: { get(name: string): string | null }): boolean {
  const hint = headers.get("sec-ch-ua-mobile");
  if (hint === "?1") return true;
  if (hint === "?0") return false;
  return /\bMobi|iPhone|iPod/i.test(headers.get("user-agent") ?? "");
}
