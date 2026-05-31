import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import PaymentHandlesClient from "./PaymentHandlesClient";

/**
 * Payment handles settings page. Lets the user store one handle each
 * for PayPal.me / Venmo / Wise so that fellow trip members can hit
 * "Pay via PayPal" / "Pay via Venmo" / "Pay via Wise" in the
 * Settle Up view of any shared-expense trip.
 *
 * NO backend payment integration — we only generate deeplinks. The
 * stored handles never leave Supabase; deeplink generation happens
 * client-side in SettleUpView using lib/payments/handle-links.
 *
 * Auth-gated server-side; the actual form lives in the client
 * component, which reads + writes via the existing GET/PATCH
 * /api/profile endpoint (extended with the 3 new columns).
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale,
    namespace: "expenses.payments.settings",
  });
  return {
    // Strip brand suffix — root layout's title.template adds it.
    title: t("title"),
    description: t("description"),
    // Settings pages should never be indexed.
    robots: { index: false, follow: false },
  };
}

export default async function PaymentHandlesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/auth/login?next=/settings/payment-handles");
  }

  return <PaymentHandlesClient />;
}
