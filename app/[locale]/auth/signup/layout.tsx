import type { Metadata } from "next";

const BASE_URL = "https://monkeytravel.app";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const prefix = locale === "en" ? "" : `/${locale}`;

  return {
    title: "Create Account",
    description: "Create a free MonkeyTravel account and start planning AI-powered trips.",
    alternates: {
      canonical: `${BASE_URL}${prefix}/auth/signup`,
      languages: {
        en: `${BASE_URL}/auth/signup`,
        es: `${BASE_URL}/es/auth/signup`,
        it: `${BASE_URL}/it/auth/signup`,
        "x-default": `${BASE_URL}/auth/signup`,
      },
    },
  };
}

export default function SignupLayout({ children }: { children: React.ReactNode }) {
  return children;
}
