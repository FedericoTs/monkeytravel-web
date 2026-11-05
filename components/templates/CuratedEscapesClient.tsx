"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Image from "next/image";
import { Sparkles, ChevronRight, ChevronLeft } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { proxyImageUrl } from "@/lib/img/proxyUrl";
import { SeeAllCard, TemplateCard, type CuratedEscapesT, type TemplateTrip } from "./TemplateCard";

/** A drag across the carousel must not follow a card's link. */
const carouselLinkProps = (preventClick: boolean) => ({
  prefetch: false,
  draggable: false,
  onClick: (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (preventClick) e.preventDefault();
  },
});

/** A card in the carousel, whose photo can fail and falls back to the gradient. */
function CarouselTemplateCard({
  template,
  preventClick,
  t,
}: {
  template: TemplateTrip;
  preventClick: boolean;
  t: CuratedEscapesT;
}) {
  // Eager-true when we already have a URL — next/image with `unoptimized`
  // is effectively a raw <img> and onLoad doesn't fire for browser-cached
  // images. See hooks/useImageLoaded.ts for the explanation. (We can't
  // use the ref-based hook here because next/image doesn't expose the
  // underlying <img>; eager-true is the next-best.)
  const [imageLoaded, setImageLoaded] = useState(Boolean(template.coverImageUrl));
  const [imageError, setImageError] = useState(false);

  return (
    <TemplateCard
      template={template}
      t={t}
      coverMissing={!template.coverImageUrl || imageError}
      linkProps={carouselLinkProps(preventClick)}
      image={
        template.coverImageUrl &&
        !imageError && (
          <Image
            // Proxy Pexels/Unsplash through same-origin route — direct
            // browser loads to Pexels CDN intermittently 504 (Cloudflare).
            // See lib/img/proxyUrl.ts.
            src={proxyImageUrl(template.coverImageUrl) || template.coverImageUrl}
            alt={template.title}
            fill
            unoptimized
            sizes="300px"
            loading="lazy"
            draggable={false}
            onLoad={() => setImageLoaded(true)}
            onError={() => setImageError(true)}
            className={`object-cover transition-all duration-500 group-hover:scale-105 ${
              imageLoaded ? "opacity-100" : "opacity-0"
            }`}
          />
        )
      }
    />
  );
}

function SkeletonCard() {
  return (
    <div className="flex-shrink-0 w-[260px] md:w-[300px] bg-white rounded-2xl border border-slate-200/80 overflow-hidden animate-pulse">
      <div className="aspect-[4/3] bg-slate-200" />
      <div className="p-4 space-y-3">
        <div className="h-3 bg-slate-200 rounded w-full" />
        <div className="h-3 bg-slate-200 rounded w-2/3" />
        <div className="flex gap-2">
          <div className="h-6 w-16 bg-slate-100 rounded-lg" />
          <div className="h-6 w-16 bg-slate-100 rounded-lg" />
        </div>
      </div>
    </div>
  );
}

/**
 * Client-side variant of CuratedEscapes.
 * Use ONLY from authenticated client trees (TripsPageClient) where SEO does
 * not apply. The public homepage uses the server-side CuratedEscapes which
 * emits template links in initial SSR HTML for crawl discoverability.
 */
export default function CuratedEscapesClient() {
  const t = useTranslations("common.curatedEscapes");
  const tA11y = useTranslations("common.a11y");
  const [templates, setTemplates] = useState<TemplateTrip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const [isDragging, setIsDragging] = useState(false);
  const [hasDragged, setHasDragged] = useState(false);
  const dragStartX = useRef(0);
  const dragScrollLeft = useRef(0);
  const dragVelocity = useRef(0);
  const lastDragX = useRef(0);
  const lastDragTime = useRef(0);
  const momentumFrame = useRef<number | null>(null);

  const locale = useLocale();
  useEffect(() => {
    const fetchTemplates = async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/templates?limit=6&locale=${locale}`);
        if (!response.ok) throw new Error("Failed to fetch templates");

        const data = await response.json();
        setTemplates(data.templates || []);
      } catch (err) {
        console.error("Error fetching templates:", err);
        setError("Failed to load templates");
      } finally {
        setLoading(false);
      }
    };

    fetchTemplates();
  }, [locale]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const handleScroll = () => {
      const scrollLeft = container.scrollLeft;
      const cardWidth = window.innerWidth >= 768 ? 320 + 16 : 280 + 16;
      const newIndex = Math.round(scrollLeft / cardWidth);
      setActiveIndex(Math.min(newIndex, templates.length));

      setCanScrollLeft(scrollLeft > 10);
      setCanScrollRight(scrollLeft < container.scrollWidth - container.clientWidth - 10);
    };

    handleScroll();
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, [templates.length]);

  const scrollByCards = (direction: "left" | "right") => {
    if (scrollRef.current) {
      const cardWidth = window.innerWidth >= 768 ? 320 + 16 : 280 + 16;
      const scrollAmount = direction === "left" ? -cardWidth * 2 : cardWidth * 2;
      scrollRef.current.scrollBy({
        left: scrollAmount,
        behavior: "smooth",
      });
    }
  };

  const applyMomentum = useCallback(() => {
    if (!scrollRef.current) return;

    const friction = 0.95;
    const minVelocity = 0.5;

    const animate = () => {
      if (!scrollRef.current || Math.abs(dragVelocity.current) < minVelocity) {
        momentumFrame.current = null;
        return;
      }

      scrollRef.current.scrollLeft -= dragVelocity.current;
      dragVelocity.current *= friction;
      momentumFrame.current = requestAnimationFrame(animate);
    };

    momentumFrame.current = requestAnimationFrame(animate);
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0 || !scrollRef.current) return;

    if (momentumFrame.current) {
      cancelAnimationFrame(momentumFrame.current);
      momentumFrame.current = null;
    }

    setIsDragging(true);
    setHasDragged(false);
    dragStartX.current = e.clientX;
    dragScrollLeft.current = scrollRef.current.scrollLeft;
    lastDragX.current = e.clientX;
    lastDragTime.current = Date.now();
    dragVelocity.current = 0;
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging || !scrollRef.current) return;

    const deltaX = e.clientX - dragStartX.current;

    if (Math.abs(deltaX) > 5) {
      setHasDragged(true);
    }

    const now = Date.now();
    const dt = now - lastDragTime.current;
    if (dt > 0) {
      dragVelocity.current = (e.clientX - lastDragX.current) / dt * 16;
    }
    lastDragX.current = e.clientX;
    lastDragTime.current = now;

    scrollRef.current.scrollLeft = dragScrollLeft.current - deltaX;
  }, [isDragging]);

  const handleMouseUp = useCallback(() => {
    if (!isDragging) return;

    setIsDragging(false);

    if (Math.abs(dragVelocity.current) > 2) {
      applyMomentum();
    }

    setTimeout(() => setHasDragged(false), 50);
  }, [isDragging, applyMomentum]);

  const handleMouseLeave = useCallback(() => {
    if (isDragging) {
      setIsDragging(false);
      if (Math.abs(dragVelocity.current) > 2) {
        applyMomentum();
      }
      setTimeout(() => setHasDragged(false), 50);
    }
  }, [isDragging, applyMomentum]);

  useEffect(() => {
    return () => {
      if (momentumFrame.current) {
        cancelAnimationFrame(momentumFrame.current);
      }
    };
  }, []);

  if (!loading && templates.length === 0) {
    return null;
  }

  return (
    <section className="mb-6">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[var(--primary)] to-[var(--accent)] flex items-center justify-center shadow-lg">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-900">{t("title")}</h2>
            <p className="text-sm text-slate-500">{t("subtitle")}</p>
          </div>
        </div>

        <div className="hidden md:flex items-center gap-2">
          <button
            aria-label={tA11y("scrollPrevious")}
            onClick={() => scrollByCards("left")}
            disabled={!canScrollLeft}
            className={`w-10 h-10 rounded-full border flex items-center justify-center transition-all ${
              canScrollLeft
                ? "border-slate-300 hover:border-[var(--primary)] hover:bg-[var(--primary)]/5 text-slate-600 hover:text-[var(--primary-ink)]"
                : "border-slate-200 text-slate-300 cursor-not-allowed"
            }`}
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button
            aria-label={tA11y("scrollNext")}
            onClick={() => scrollByCards("right")}
            disabled={!canScrollRight}
            className={`w-10 h-10 rounded-full border flex items-center justify-center transition-all ${
              canScrollRight
                ? "border-slate-300 hover:border-[var(--primary)] hover:bg-[var(--primary)]/5 text-slate-600 hover:text-[var(--primary-ink)]"
                : "border-slate-200 text-slate-300 cursor-not-allowed"
            }`}
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>

      {error && (
        <div className="text-center py-8 bg-red-50 rounded-xl border border-red-100">
          <p className="text-red-600">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-2 text-sm text-red-700 font-medium hover:underline"
          >
            {t("tryAgain")}
          </button>
        </div>
      )}

      {loading && (
        <div className="-mx-4 px-4">
          <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide">
            {[1, 2, 3, 4].map((i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        </div>
      )}

      {!loading && !error && templates.length > 0 && (
        <>
          <div className="-mx-4 px-4 md:-mx-6 md:px-6">
            <div
              ref={scrollRef}
              className={`flex gap-4 overflow-x-auto pb-4 scrollbar-hide ${
                isDragging ? "cursor-grabbing" : "md:cursor-grab"
              }`}
              style={{
                scrollbarWidth: "none",
                msOverflowStyle: "none",
                WebkitOverflowScrolling: "touch",
              }}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseLeave}
            >
              {templates.map((template, index) => (
                <div
                  key={template.id}
                  className="flex-shrink-0 animate-[card-fade-in_0.4s_ease-out_forwards]"
                  style={{ opacity: 0, animationDelay: `${index * 100}ms` }}
                >
                  <CarouselTemplateCard template={template} preventClick={hasDragged} t={t} />
                </div>
              ))}

              <div
                className="flex-shrink-0 animate-[card-fade-in_0.4s_ease-out_forwards]"
                style={{ opacity: 0, animationDelay: `${templates.length * 100}ms` }}
              >
                <SeeAllCard linkProps={carouselLinkProps(hasDragged)} t={t} />
              </div>
            </div>
          </div>

          <div className="mt-2 md:hidden px-4">
            <div className="relative h-0.5 bg-slate-200/60 rounded-full overflow-hidden">
              <div
                className="absolute left-0 top-0 h-full bg-[var(--primary)]/70 rounded-full transition-all duration-300 ease-out"
                style={{
                  width: `${((activeIndex + 1) / (templates.length + 1)) * 100}%`,
                }}
              />
            </div>
            <div className="flex justify-center mt-1.5">
              <span className="text-[10px] text-slate-500 font-medium tabular-nums">
                {activeIndex + 1} / {templates.length + 1}
              </span>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
