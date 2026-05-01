"use client";

import { useEffect, useState } from "react";

interface SectionEntry {
  id: string;
  label: string;
}

interface DestinationSectionNavProps {
  sections: SectionEntry[];
}

/**
 * Sticky chip-row navigation for destination detail pages. Sticks below
 * the navbar (top: 4rem) once the hero scrolls past, lets users jump
 * straight to Best Time / Highlights / Sample Day / FAQ / Plan trip.
 *
 * Active section detection uses IntersectionObserver — whichever
 * section's heading area is closest to the top of the viewport gets
 * the active state. Clicking a chip scrolls to the anchor with smooth
 * behaviour (with offset for the navbar + this nav).
 */
export default function DestinationSectionNav({ sections }: DestinationSectionNavProps) {
  const [activeId, setActiveId] = useState<string | null>(sections[0]?.id ?? null);

  useEffect(() => {
    if (sections.length === 0) return;

    // Trigger when the section's top edge crosses ~150px below viewport top
    // (offset roughly = navbar 64px + sectionnav 50px + a little headroom)
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length > 0 && visible[0].target.id) {
          setActiveId(visible[0].target.id);
        }
      },
      {
        // top: -120px → trigger when section's top crosses 120px from viewport top
        // bottom: -65% → trigger only when section is in the upper third
        rootMargin: "-120px 0px -65% 0px",
        threshold: 0,
      }
    );

    for (const { id } of sections) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }

    return () => observer.disconnect();
  }, [sections]);

  function handleClick(e: React.MouseEvent<HTMLAnchorElement>, id: string) {
    e.preventDefault();
    const el = document.getElementById(id);
    if (!el) return;
    // Compute offset = navbar (4rem = 64px) + section nav height (~50px) + 12px breathing room
    const top = el.getBoundingClientRect().top + window.scrollY - 130;
    window.scrollTo({ top, behavior: "smooth" });
    history.replaceState(null, "", `#${id}`);
  }

  return (
    <div className="sticky top-16 z-40 bg-white/90 backdrop-blur-sm border-b border-slate-200/80">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <nav className="flex items-center gap-1.5 overflow-x-auto py-3 scrollbar-hide" aria-label="Section navigation">
          {sections.map(({ id, label }) => {
            const active = activeId === id;
            return (
              <a
                key={id}
                href={`#${id}`}
                onClick={(e) => handleClick(e, id)}
                className={`shrink-0 inline-flex items-center px-3.5 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  active
                    ? "bg-[var(--primary)] text-white"
                    : "text-slate-600 hover:text-[var(--primary)] hover:bg-[var(--primary)]/5"
                }`}
              >
                {label}
              </a>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
