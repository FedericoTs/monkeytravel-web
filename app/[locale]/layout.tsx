import { NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { ToastProvider } from "@/components/ui/Toast";
import MaintenanceWrapper from "@/components/MaintenanceWrapper";
import { ProfileCompletionProvider } from "@/components/profile";
import { ConsentWrapper } from "@/components/consent";
import { routing } from "@/lib/i18n/routing";

// Generate static params for all supported locales
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

interface LocaleLayoutProps {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}

export default async function LocaleLayout({
  children,
  params,
}: LocaleLayoutProps) {
  const { locale } = await params;

  // Validate locale
  if (!routing.locales.includes(locale as typeof routing.locales[number])) {
    notFound();
  }

  // Enable static rendering
  setRequestLocale(locale);

  // Get all messages for client components
  const messages = await getMessages();

  return (
    <NextIntlClientProvider messages={messages} locale={locale}>
      <ConsentWrapper>
        <ToastProvider>
          <ProfileCompletionProvider>
            <MaintenanceWrapper>{children}</MaintenanceWrapper>
          </ProfileCompletionProvider>
        </ToastProvider>
      </ConsentWrapper>
    </NextIntlClientProvider>
  );
}
