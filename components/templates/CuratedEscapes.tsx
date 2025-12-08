"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { Sparkles, ChevronRight, ChevronLeft, Users, ArrowRight, MapPin } from "lucide-react";
import { motion } from "framer-motion";

interface TemplateTrip {
  id: string;
  title: string;
  description: string;
  destination: string;
  country: string;
  countryCode: string;
  coverImageUrl: string;
  durationDays: number;
  budgetTier: "budget" | "moderate" | "luxury";
  moodTags: string[];
  tags: string[];
  copyCount: number;
}

// Mood tag configuration
const MOOD_OPTIONS: Record<string, { label: string; emoji: string }> = {
  romantic: { label: "Romantic", emoji: "💕" },
  adventure: { label: "Adventure", emoji: "🏔️" },
  cultural: { label: "Cultural", emoji: "🏛️" },
  relaxation: { label: "Relaxation", emoji: "🌴" },
  foodie: { label: "Foodie", emoji: "🍝" },
  family: { label: "Family", emoji: "👨‍👩‍👧‍👦" },
};

// Country code to flag emoji
function getFlagEmoji(countryCode: string): string {
  if (!countryCode) return "🌍";
  const codePoints = countryCode
    .toUpperCase()
    .split("")
    .map((char) => 127397 + char.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}

// Gradient fallbacks by destination
const DESTINATION_GRADIENTS: Record<string, { from: string; to: string }> = {
  paris: { from: "#E8B4B8", to: "#D4919A" },
  rome: { from: "#C9A86C", to: "#9E7B4F" },
  tokyo: { from: "#FFB7C5", to: "#FF6B9D" },
  barcelona: { from: "#F6AD55", to: "#ED8936" },
  bali: { from: "#4FD1C5", to: "#38B2AC" },
  london: { from: "#6B7B8C", to: "#4A5568" },
  dubai: { from: "#D69E2E", to: "#B7791F" },
  amsterdam: { from: "#68D391", to: "#48BB78" },
  santorini: { from: "#63B3ED", to: "#4299E1" },
  iceland: { from: "#A0AEC0", to: "#718096" },
  "new york": { from: "#667EEA", to: "#764BA2" },
  default: { from: "#718096", to: "#4A5568" },
};

function getGradient(destination: string) {
  const key = destination.toLowerCase().split(",")[0].trim();
  return DESTINATION_GRADIENTS[key] || DESTINATION_GRADIENTS.default;
}

interface TemplateCardProps {
  template: TemplateTrip;
  preventClick: boolean;
}

function TemplateCard({ template, preventClick }: TemplateCardProps) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const gradient = getGradient(template.destination);

  const budgetLabel =
    template.budgetTier === "budget"
      ? "€"
      : template.budgetTier === "moderate"
      ? "€€"
      : "€€€";

  const handleClick = (e: React.MouseEvent) => {
    if (preventClick) {
      e.preventDefault();
    }
  };

  return (
    <Link
      href={`/trips/template/${template.id}`}
      onClick={handleClick}
      draggable={false}
      className="
        group bg-white rounded-2xl border border-slate-200 overflow-hidden
        hover:shadow-xl transition-all duration-300 hover:border-slate-300
        hover:-translate-y-1 block flex-shrink-0
        w-[280px] md:w-[320px]
      "
    >
      {/* Cover Image */}
      <div
        className="h-40 md:h-44 relative overflow-hidden"
        style={{
          background:
            !template.coverImageUrl || imageError
              ? `linear-gradient(135deg, ${gradient.from} 0%, ${gradient.to} 100%)`
              : undefined,
        }}
      >
        {template.coverImageUrl && !imageError && (
          <img
            src={template.coverImageUrl}
            alt={template.title}
            draggable={false}
            onLoad={() => setImageLoaded(true)}
            onError={() => setImageError(true)}
            className={`absolute inset-0 w-full h-full object-cover transition-all duration-500 group-hover:scale-105 ${
              imageLoaded ? "opacity-100" : "opacity-0"
            }`}
          />
        )}

        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />

        {/* Duration badge */}
        <div className="absolute top-3 left-3">
          <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-white/90 backdrop-blur-sm text-slate-700 shadow-sm">
            {template.durationDays} days
          </span>
        </div>

        {/* Budget badge */}
        <div className="absolute top-3 right-3">
          <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-white/90 backdrop-blur-sm text-amber-600 shadow-sm">
            {budgetLabel}
          </span>
        </div>

        {/* Destination + Country */}
        <div className="absolute bottom-0 left-0 right-0 p-4">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-base">{getFlagEmoji(template.countryCode)}</span>
            <span className="text-white/80 text-xs">{template.country}</span>
          </div>
          <h3 className="text-lg md:text-xl font-bold text-white drop-shadow-lg line-clamp-1">
            {template.destination}
          </h3>
        </div>
      </div>

      {/* Info */}
      <div className="p-4">
        {/* Description */}
        <p className="text-slate-600 text-sm line-clamp-2 mb-3">
          {template.description}
        </p>

        {/* Mood tags */}
        <div className="flex flex-wrap gap-1.5 mb-3">
          {template.moodTags.slice(0, 3).map((mood) => {
            const option = MOOD_OPTIONS[mood];
            return (
              <span
                key={mood}
                className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600"
              >
                {option?.emoji} {option?.label || mood}
              </span>
            );
          })}
        </div>

        {/* CTA */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-400 flex items-center gap-1">
            {template.copyCount > 0 && (
              <>
                <Users className="w-3.5 h-3.5" />
                {template.copyCount} travelers
              </>
            )}
          </span>
          <span className="text-[var(--primary)] font-medium text-sm flex items-center gap-1 group-hover:gap-2 transition-all">
            Explore
            <ChevronRight className="w-4 h-4" />
          </span>
        </div>
      </div>
    </Link>
  );
}

// "See All" card
function SeeAllCard({ preventClick }: { preventClick: boolean }) {
  const handleClick = (e: React.MouseEvent) => {
    if (preventClick) {
      e.preventDefault();
    }
  };

  return (
    <Link
      href="/templates"
      onClick={handleClick}
      draggable={false}
      className="
        group flex-shrink-0 w-[200px] md:w-[240px]
        bg-gradient-to-br from-[var(--primary)] to-[var(--primary)]/80
        rounded-2xl overflow-hidden relative
        flex flex-col items-center justify-center
        hover:shadow-xl transition-all duration-300
        hover:scale-[1.02] active:scale-[0.98]
        min-h-[320px] md:min-h-[360px]
      "
    >
      {/* Decorative elements */}
      <div className="absolute inset-0 overflow-hidden opacity-20">
        <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-[var(--accent)]" />
        <div className="absolute -bottom-10 -left-10 w-32 h-32 rounded-full bg-white" />
      </div>

      <div className="relative z-10 flex flex-col items-center text-center px-4">
        {/* Icon */}
        <div className="w-16 h-16 md:w-20 md:h-20 rounded-2xl bg-white/20 backdrop-blur flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
          <MapPin className="w-8 h-8 md:w-10 md:h-10 text-white" />
        </div>

        {/* Text */}
        <h3 className="text-white font-bold text-lg md:text-xl mb-2">
          Explore All
        </h3>
        <p className="text-white/80 text-sm mb-4">
          Discover more curated itineraries
        </p>

        {/* Arrow */}
        <div className="flex items-center gap-2 text-[var(--accent)] font-semibold text-sm group-hover:gap-3 transition-all">
          <span>Browse</span>
          <ArrowRight className="w-5 h-5" />
        </div>
      </div>
    </Link>
  );
}

// Loading skeleton
function SkeletonCard() {
  return (
    <div className="flex-shrink-0 w-[280px] md:w-[320px] bg-white rounded-2xl border border-slate-200 overflow-hidden animate-pulse">
      <div className="h-40 md:h-44 bg-slate-200" />
      <div className="p-4 space-y-3">
        <div className="h-3 bg-slate-200 rounded w-3/4" />
        <div className="h-3 bg-slate-200 rounded w-1/2" />
        <div className="flex gap-2">
          <div className="h-5 w-14 bg-slate-200 rounded-full" />
          <div className="h-5 w-14 bg-slate-200 rounded-full" />
        </div>
      </div>
    </div>
  );
}

export default function CuratedEscapes() {
  const [templates, setTemplates] = useState<TemplateTrip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Desktop drag-to-scroll state (mouse only, not touch)
  const [isDragging, setIsDragging] = useState(false);
  const [hasDragged, setHasDragged] = useState(false);
  const dragStartX = useRef(0);
  const dragScrollLeft = useRef(0);
  const dragVelocity = useRef(0);
  const lastDragX = useRef(0);
  const lastDragTime = useRef(0);
  const momentumFrame = useRef<number | null>(null);

  // Fetch templates
  useEffect(() => {
    const fetchTemplates = async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch("/api/templates?limit=6");
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
  }, []);

  // Track scroll position for indicators and buttons
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

  const scrollToIndex = (index: number) => {
    if (scrollRef.current) {
      const cardWidth = window.innerWidth >= 768 ? 320 + 16 : 280 + 16;
      scrollRef.current.scrollTo({
        left: index * cardWidth,
        behavior: "smooth",
      });
    }
  };

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

  // Momentum scrolling after drag release
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

  // Mouse drag handlers (desktop only - touch uses native scroll)
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Only handle left mouse button
    if (e.button !== 0 || !scrollRef.current) return;

    // Cancel any ongoing momentum
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

    // Mark as dragged if moved more than 5px (prevents accidental drag on click)
    if (Math.abs(deltaX) > 5) {
      setHasDragged(true);
    }

    // Calculate velocity for momentum
    const now = Date.now();
    const dt = now - lastDragTime.current;
    if (dt > 0) {
      dragVelocity.current = (e.clientX - lastDragX.current) / dt * 16; // normalize to ~60fps
    }
    lastDragX.current = e.clientX;
    lastDragTime.current = now;

    // Smooth scrolling - directly set scroll position
    scrollRef.current.scrollLeft = dragScrollLeft.current - deltaX;
  }, [isDragging]);

  const handleMouseUp = useCallback(() => {
    if (!isDragging) return;

    setIsDragging(false);

    // Apply momentum if there was significant velocity
    if (Math.abs(dragVelocity.current) > 2) {
      applyMomentum();
    }

    // Reset hasDragged after a short delay to prevent click
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

  // Cleanup momentum on unmount
  useEffect(() => {
    return () => {
      if (momentumFrame.current) {
        cancelAnimationFrame(momentumFrame.current);
      }
    };
  }, []);

  // Don't render if no templates
  if (!loading && templates.length === 0) {
    return null;
  }

  return (
    <section className="mb-10">
      {/* Section Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[var(--primary)] to-[var(--accent)] flex items-center justify-center shadow-lg">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-900">Curated Escapes</h2>
            <p className="text-sm text-slate-500">
              Hand-picked itineraries ready to explore
            </p>
          </div>
        </div>

        {/* Desktop scroll buttons */}
        <div className="hidden md:flex items-center gap-2">
          <button
            onClick={() => scrollByCards("left")}
            disabled={!canScrollLeft}
            className={`w-10 h-10 rounded-full border flex items-center justify-center transition-all ${
              canScrollLeft
                ? "border-slate-300 hover:border-[var(--primary)] hover:bg-[var(--primary)]/5 text-slate-600 hover:text-[var(--primary)]"
                : "border-slate-200 text-slate-300 cursor-not-allowed"
            }`}
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button
            onClick={() => scrollByCards("right")}
            disabled={!canScrollRight}
            className={`w-10 h-10 rounded-full border flex items-center justify-center transition-all ${
              canScrollRight
                ? "border-slate-300 hover:border-[var(--primary)] hover:bg-[var(--primary)]/5 text-slate-600 hover:text-[var(--primary)]"
                : "border-slate-200 text-slate-300 cursor-not-allowed"
            }`}
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Error State */}
      {error && (
        <div className="text-center py-8 bg-red-50 rounded-xl border border-red-100">
          <p className="text-red-600">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-2 text-sm text-red-700 font-medium hover:underline"
          >
            Try again
          </button>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="-mx-4 px-4">
          <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide">
            {[1, 2, 3, 4].map((i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        </div>
      )}

      {/* Templates Carousel */}
      {!loading && !error && templates.length > 0 && (
        <>
          <div className="-mx-4 px-4 md:-mx-6 md:px-6">
            <div
              ref={scrollRef}
              className={`
                flex gap-4 overflow-x-auto pb-4
                scrollbar-hide
                ${isDragging ? "cursor-grabbing" : "md:cursor-grab"}
              `}
              style={{
                scrollbarWidth: "none",
                msOverflowStyle: "none",
                // Allow native touch scrolling on mobile
                WebkitOverflowScrolling: "touch",
              }}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseLeave}
            >
              {templates.map((template, index) => (
                <motion.div
                  key={template.id}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.1 }}
                  className="flex-shrink-0"
                >
                  <TemplateCard template={template} preventClick={hasDragged} />
                </motion.div>
              ))}

              {/* See All Card */}
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: templates.length * 0.1 }}
                className="flex-shrink-0"
              >
                <SeeAllCard preventClick={hasDragged} />
              </motion.div>
            </div>
          </div>

          {/* Scroll indicator dots - Mobile only */}
          <div className="flex justify-center gap-1.5 mt-3 md:hidden">
            {[...templates, { id: 'see-all' }].map((_, index) => (
              <button
                key={index}
                onClick={() => scrollToIndex(index)}
                className={`transition-all duration-300 rounded-full ${
                  index === activeIndex
                    ? "w-6 h-2 bg-[var(--primary)]"
                    : "w-2 h-2 bg-slate-300 hover:bg-slate-400"
                }`}
                aria-label={`Go to slide ${index + 1}`}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
