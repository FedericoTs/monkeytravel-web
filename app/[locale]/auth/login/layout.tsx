import type { Metadata } from "next";

const BASE_URL = "https://monkeytravel.app";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const prefix = locale === "en" ? "" : `/${locale}`;

  return {
    title: "Sign In",
    description: "Sign in to MonkeyTravel to plan your next trip with AI.",
    alternates: {
      canonical: `${BASE_URL}${prefix}/auth/login`,
      languages: {
        en: `${BASE_URL}/auth/login`,
        es: `${BASE_URL}/es/auth/login`,
        it: `${BASE_URL}/it/auth/login`,
        "x-default": `${BASE_URL}/auth/login`,
      },
    },
  };
}

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
