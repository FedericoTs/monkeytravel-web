import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Personalize Your Experience",
  robots: { index: false, follow: false },
};

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
