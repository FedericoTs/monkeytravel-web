import { NextIntlClientProvider } from "next-intl";
import { APP_CLIENT_NAMESPACES, pickMessages } from "@/lib/i18n/client-messages";
import { getMessages, setRequestLocale } from "next-intl/server";
import { LocaleProvider } from "@/lib/locale";
import { PlaceCacheProvider } from "@/lib/context/PlaceCacheContext";
import { ToastProvider } from "@/components/ui/Toast";
import ProfileCompletionProvider from "@/components/profile/ProfileCompletionProvider";

interface AppLayoutProps {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}

/**
 * The app surface: every route that is not marketing content. Its pages get
 * the messages their client code reads and the providers only they use (unit and currency
 * preferences, the place-photo cache, toasts, the profile nudge); the root
 * layout keeps the marketing pages on the lighter set.
 */
export default async function AppLayout({ children, params }: AppLayoutProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const messages = await getMessages();

  return (
    <NextIntlClientProvider messages={pickMessages(messages, APP_CLIENT_NAMESPACES)} locale={locale}>
      <LocaleProvider>
        <PlaceCacheProvider>
          <ToastProvider>
            <ProfileCompletionProvider>{children}</ProfileCompletionProvider>
          </ToastProvider>
        </PlaceCacheProvider>
      </LocaleProvider>
    </NextIntlClientProvider>
  );
}
