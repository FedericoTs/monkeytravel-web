import type { Metadata } from "next";
import { bodyFontClassName } from "@/app/fonts";
import { PostHogProviderWrapper } from "@/app/providers";
import { LocaleProvider } from "@/lib/locale";
import { PlaceCacheProvider } from "@/lib/context/PlaceCacheContext";
import "@/app/globals.css";

export const metadata: Metadata = {
  title: { default: "Admin", template: "%s | MonkeyTravel" },
  robots: { index: false, follow: false },
};

// Always rendered per request: admin pages are gated on the session.
export const dynamic = "force-dynamic";

/**
 * Root layout for /admin, which sits outside the [locale] tree (no
 * translations, no locale in the URL). Same shell as the site's root layout
 * minus the marketing scripts and beacons.
 */
export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={bodyFontClassName}>
        <PostHogProviderWrapper>
          <LocaleProvider>
            <PlaceCacheProvider>{children}</PlaceCacheProvider>
          </LocaleProvider>
        </PostHogProviderWrapper>
      </body>
    </html>
  );
}
