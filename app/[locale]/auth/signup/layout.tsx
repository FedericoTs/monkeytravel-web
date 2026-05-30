import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

/**
 * Server-side metadata for /[locale]/auth/signup.
 *
 * Same pattern as the login layout — see neighbouring file for context.
 * The signup page is "use client" so metadata has to come from this
 * server-rendered layout wrapper.
 *
 * 2026-05-30 (task #250).
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auth.meta" });
  return {
    title: t("signupTitle"),
  };
}

export default function SignupLayout({ children }: { children: React.ReactNode }) {
  return children;
}
