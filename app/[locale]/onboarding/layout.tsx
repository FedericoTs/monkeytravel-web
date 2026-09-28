import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Personalize Your Experience",
  robots: { index: false, follow: false },
};

// Rendered per request: the page reads the session and the query string.
export const dynamic = "force-dynamic";

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
