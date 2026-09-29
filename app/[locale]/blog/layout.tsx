import { NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { BLOG_CLIENT_NAMESPACES, pickMessages } from "@/lib/i18n/client-messages";

interface BlogLayoutProps {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}

/** The blog's client components (grid filters, sticky CTA) read the blog namespace; no other marketing page does. */
export default async function BlogLayout({ children, params }: BlogLayoutProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const messages = await getMessages();

  return (
    <NextIntlClientProvider messages={pickMessages(messages, BLOG_CLIENT_NAMESPACES)} locale={locale}>
      {children}
    </NextIntlClientProvider>
  );
}
