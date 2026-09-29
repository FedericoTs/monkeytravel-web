import { NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { TOOLS_CLIENT_NAMESPACES, pickMessages } from "@/lib/i18n/client-messages";

interface ToolsLayoutProps {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}

/** The tool forms read the tools namespace, and the packing list borrows the wizard's date picker. */
export default async function ToolsLayout({ children, params }: ToolsLayoutProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const messages = await getMessages();

  return (
    <NextIntlClientProvider messages={pickMessages(messages, TOOLS_CLIENT_NAMESPACES)} locale={locale}>
      {children}
    </NextIntlClientProvider>
  );
}
