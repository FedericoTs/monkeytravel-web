import { redirect } from "next/navigation";

/**
 * Old notification links (vote and proposal notifications, the email/push
 * fallback) pointed at /trips/<id>/edit, a page that never existed: they
 * 404'd. New notifications link to /trips/<id>; this keeps every link already
 * sent or stored working.
 */
export default async function TripEditRedirect({
  params,
}: {
  params: Promise<{ id: string; locale: string }>;
}) {
  const { id, locale } = await params;
  const localePrefix = locale === "en" ? "" : `/${locale}`;
  redirect(`${localePrefix}/trips/${id}`);
}
