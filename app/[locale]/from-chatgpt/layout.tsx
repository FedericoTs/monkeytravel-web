import { NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { CHATGPT_IMPORT_CLIENT_NAMESPACES, pickMessages } from "@/lib/i18n/client-messages";

interface ChatGPTImportLayoutProps {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}

/** The import page's client component reads its own namespace and the activity type labels; no other marketing page does. */
export default async function ChatGPTImportLayout({ children, params }: ChatGPTImportLayoutProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const messages = await getMessages();

  return (
    <NextIntlClientProvider messages={pickMessages(messages, CHATGPT_IMPORT_CLIENT_NAMESPACES)} locale={locale}>
      {children}
    </NextIntlClientProvider>
  );
}
