"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { commonsPage, readCredit, type PhotoCredit as Credit } from "@/lib/images/wikimedia-credit";

/**
 * The credit a Wikimedia photo's licence asks for where the photo shows: its
 * author and licence, linked to the photo's Commons page. Other photos get
 * nothing. A click on the credit doesn't reach the card underneath.
 */

function useCreditText() {
  const t = useTranslations("common.destination");
  return (c: Credit) => t("photoCredit", { author: c.author || "Wikimedia Commons", license: c.license });
}

/** The credit over a photo, in a corner of its (positioned) container. */
export function PhotoCredit({ src, className = "bottom-2 right-2" }: { src: string | null | undefined; className?: string }) {
  const text = useCreditText();
  const credit = readCredit(src);
  if (!credit) return null;
  return (
    <a
      href={commonsPage(credit.file)}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className={`absolute z-10 max-w-[60%] truncate rounded bg-black/40 px-1.5 py-0.5 text-[10px] leading-tight text-white/90 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white ${className}`}
    >
      {text(credit)}
    </a>
  );
}

/** A thumbnail too small for a credit line: the photo links to its Commons page, the credit in its title. */
export function CreditedThumb({ src, children }: { src: string | null | undefined; children: ReactNode }) {
  const text = useCreditText();
  const credit = readCredit(src);
  if (!credit) return <>{children}</>;
  return (
    <a
      href={commonsPage(credit.file)}
      target="_blank"
      rel="noopener noreferrer"
      title={text(credit)}
      aria-label={text(credit)}
      onClick={(e) => e.stopPropagation()}
      className="block h-full w-full"
    >
      {children}
    </a>
  );
}
