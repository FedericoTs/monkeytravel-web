import { notFound } from "next/navigation";

// Unknown paths inside a locale render app/[locale]/not-found.tsx through the
// site layout. Per request: the URL is not in the CSP hash manifest, so
// middleware sends the nonce policy, which only a per-request render honours.
export const dynamic = "force-dynamic";

export default function CatchAllPage() {
  notFound();
}
