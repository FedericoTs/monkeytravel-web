"use client";

import { useState, useEffect } from "react";
import { Link } from "@/lib/i18n/routing";
import { useTranslations } from "next-intl";

/**
 * Sticky bottom CTA bar for blog posts on mobile.
 * Appears after scrolling past the hero, hides when the bottom CTA section
 * is visible (to avoid duplicate CTAs on screen).
 */
export default function StickyBlogCta() {
  const t = useTranslations("blog.detail");
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    function handleScroll() {
      const scrollY = window.scrollY;
      const viewportHeight = window.innerHeight;
      const docHeight = document.documentElement.scrollHeight;

      // Show after scrolling 400px (past the hero)
      const pastHero = scrollY > 400;

      // Hide when near the bottom (within 600px of the bottom CTA section)
      const nearBottom = scrollY + viewportHeight > docHeight - 600;

      setVisible(pastHero && !nearBottom);
    }

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  if (!visible) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 sm:hidden animate-in slide-in-from-bottom-4 duration-300">
      <div className="bg-white/95 backdrop-blur-sm border-t border-slate-200 px-4 py-3 shadow-lg">
        <Link
          href="/trips/new"
          className="flex items-center justify-center gap-2 w-full px-6 py-3 rounded-full bg-[var(--accent)] text-slate-900 font-semibold text-sm active:bg-[var(--accent)]/80 transition-all min-h-[48px] shadow-sm"
        >
          {t("stickyCtaButton")}
        </Link>
      </div>
    </div>
  );
}
