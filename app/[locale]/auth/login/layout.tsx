import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

/**
 * Server-side metadata for /[locale]/auth/login.
 *
 * The page itself is "use client" (form state, supabase client, etc.),
 * which means it can't export `metadata`. We hoist it here so the title
 * resolves on the server with the user's locale — fixing the regression
 * where /it/auth/login and /es/auth/login both shipped "Sign In" in
 * English in the browser tab + social previews.
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
    title: t("loginTitle"),
  };
}

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
