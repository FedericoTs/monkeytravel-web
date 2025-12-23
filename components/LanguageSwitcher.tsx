"use client";

import { useState, useRef, useEffect } from "react";
import { useLocale } from "next-intl";
import { useRouter, usePathname } from "next/navigation";
import { Globe, Check, ChevronDown } from "lucide-react";
import { locales, localeNames, localeFlags, type Locale } from "@/i18n";

interface LanguageSwitcherProps {
  variant?: "dropdown" | "inline";
  showLabel?: boolean;
  className?: string;
}

export default function LanguageSwitcher({
  variant = "dropdown",
  showLabel = true,
  className = "",
}: LanguageSwitcherProps) {
  const locale = useLocale() as Locale;
  const router = useRouter();
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleLanguageChange = (newLocale: Locale) => {
    // Remove current locale prefix if present
    let pathWithoutLocale = pathname;
    for (const loc of locales) {
      if (pathname.startsWith(`/${loc}/`) || pathname === `/${loc}`) {
        pathWithoutLocale = pathname.slice(loc.length + 1) || "/";
        break;
      }
    }

    // Build new path
    const newPath =
      newLocale === "en"
        ? pathWithoutLocale || "/"
        : `/${newLocale}${pathWithoutLocale === "/" ? "" : pathWithoutLocale}`;

    // Set cookie for persistence
    document.cookie = `NEXT_LOCALE=${newLocale};path=/;max-age=31536000;SameSite=Lax`;

    // Navigate to new locale
    router.push(newPath);
    setIsOpen(false);
  };

  if (variant === "inline") {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        {locales.map((loc) => (
          <button
            key={loc}
            onClick={() => handleLanguageChange(loc)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
              locale === loc
                ? "bg-[var(--primary)] text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {localeFlags[loc]} {showLabel && localeNames[loc]}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div ref={dropdownRef} className={`relative ${className}`}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors"
        aria-label="Select language"
      >
        <Globe className="w-4 h-4" />
        {showLabel && (
          <>
            <span className="hidden sm:inline">{localeNames[locale]}</span>
            <span className="sm:hidden">{localeFlags[locale]}</span>
          </>
        )}
        <ChevronDown
          className={`w-3 h-3 transition-transform ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-1 py-1 bg-white rounded-lg shadow-lg border border-slate-200 min-w-[160px] z-50">
          {locales.map((loc) => (
            <button
              key={loc}
              onClick={() => handleLanguageChange(loc)}
              className={`w-full flex items-center justify-between px-4 py-2 text-sm transition-colors ${
                locale === loc
                  ? "bg-[var(--primary)]/5 text-[var(--primary)]"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              <span className="flex items-center gap-2">
                <span>{localeFlags[loc]}</span>
                <span>{localeNames[loc]}</span>
              </span>
              {locale === loc && <Check className="w-4 h-4" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
