"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useDebounce } from "@/hooks/useDebounce";
import { STAY_NAME_MAX, cleanStayName } from "@/lib/trips/stay";
import type { TripStay } from "@/types";

interface StayPlace {
  name: string;
  detail: string;
  lat: number;
  lng: number;
}

const SEARCH_SETTLE_MS = 350;

async function fetchStayPlaces(
  input: string,
  near: { latitude: number; longitude: number },
  locale: string,
  signal: AbortSignal
): Promise<StayPlace[]> {
  try {
    const res = await fetch("/api/places/stay-search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input, near, locale }),
      signal,
    });
    const json = await res.json().catch(() => null);
    return res.ok && Array.isArray(json?.places) ? (json.places as StayPlace[]) : [];
  } catch {
    return [];
  }
}

/**
 * Step 1's "Where are you staying?", optional and folded to one small link,
 * since step 1 is where most people leave. A hotel, an address or an area:
 * picked from the suggestions near the destination it comes with where it is;
 * typed, it goes to the plan as their words. The plan then starts and ends
 * each day near it.
 */
export default function StayField({
  stay,
  onChange,
  near,
}: {
  stay: TripStay | null;
  onChange: (stay: TripStay | null) => void;
  /** The destination's coordinates; suggestions need them, free text doesn't. */
  near: { latitude: number; longitude: number } | null;
}) {
  const t = useTranslations("trips");
  const locale = useLocale();
  const listId = useId();
  const inputId = useId();
  const [open, setOpen] = useState(Boolean(stay));
  const [text, setText] = useState(stay?.name ?? "");
  const [places, setPlaces] = useState<StayPlace[]>([]);
  const [active, setActive] = useState(-1);
  // What this field last handed over: leaving the box with those words changes nothing.
  const emitted = useRef<TripStay | null>(stay);
  const query = useDebounce(text, SEARCH_SETTLE_MS);

  // A stay set from outside (a restored draft, Start Over, a new destination)
  // shows in the box, adjusted as the prop changes rather than after.
  const [shown, setShown] = useState(stay);
  if (stay !== shown) {
    setShown(stay);
    setText(stay?.name ?? "");
    setPlaces([]);
    if (stay) setOpen(true);
  }

  const emit = (next: TripStay | null) => {
    emitted.current = next;
    onChange(next);
  };

  // The name a pick put in the box: it needs no search of its own.
  const picked = useRef<string | null>(null);
  useEffect(() => {
    const input = query.trim();
    if (!open || !near || input.length < 3 || input === picked.current) {
      setPlaces([]);
      return;
    }
    const controller = new AbortController();
    void fetchStayPlaces(input, near, locale, controller.signal).then((found) => {
      if (!controller.signal.aborted) {
        setPlaces(found);
        setActive(-1);
      }
    });
    return () => controller.abort();
  }, [query, open, near, locale]);

  const pick = (place: StayPlace) => {
    picked.current = place.name;
    setText(place.name);
    setPlaces([]);
    emit({ name: cleanStayName(place.name), coordinates: { lat: place.lat, lng: place.lng } });
  };

  // Typed words become the stay as they are. Words that are already the stay,
  // as a pick leaves them, stay as they were: the pick carries its place.
  const commitTyped = () => {
    const name = cleanStayName(text);
    if (name === (stay?.name ?? "") || name === (emitted.current?.name ?? "")) return;
    emit(name ? { name } : null);
  };

  const clear = () => {
    setText("");
    setPlaces([]);
    emit(null);
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-[44px] text-left text-sm font-medium text-[var(--secondary-ink)] underline-offset-2 hover:underline"
      >
        {t("wizard.step1.stay.add")}
      </button>
    );
  }

  const listOpen = places.length > 0;
  return (
    <div className="relative">
      <label htmlFor={inputId} className="block text-sm font-medium text-slate-800">
        {t("wizard.step1.stay.label")} <span className="font-normal text-slate-500">{t("wizard.step1.stay.optional")}</span>
      </label>
      <div className="mt-1 flex items-center gap-2">
        <input
          id={inputId}
          type="text"
          role="combobox"
          aria-expanded={listOpen}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          value={text}
          maxLength={STAY_NAME_MAX}
          placeholder={t("wizard.step1.stay.placeholder")}
          autoComplete="off"
          onChange={(event) => setText(event.target.value)}
          onBlur={commitTyped}
          onKeyDown={(event) => {
            if (!listOpen) return;
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActive((i) => (i + 1) % places.length);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive((i) => (i <= 0 ? places.length - 1 : i - 1));
            } else if (event.key === "Enter" && active >= 0) {
              event.preventDefault();
              pick(places[active]);
            } else if (event.key === "Escape") {
              setPlaces([]);
            }
          }}
          className="min-h-[44px] w-full rounded-xl border border-slate-300 px-3 py-2 text-base text-slate-900 focus:border-[var(--secondary-ink)] focus:outline-none focus:ring-1 focus:ring-[var(--secondary-ink)] sm:text-sm"
        />
        {text && (
          <button
            type="button"
            onClick={clear}
            aria-label={t("wizard.step1.stay.clear")}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-300 text-slate-600 hover:border-slate-400"
          >
            ×
          </button>
        )}
      </div>
      {listOpen && (
        <ul id={listId} role="listbox" className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
          {places.map((place, i) => (
            <li
              key={`${place.name}-${place.lat}-${place.lng}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              // Before the input's blur, so the pick wins over the typed words.
              onMouseDown={(event) => {
                event.preventDefault();
                pick(place);
              }}
              className={`cursor-pointer px-3 py-2 text-sm ${i === active ? "bg-slate-100" : "hover:bg-slate-50"}`}
            >
              <span className="block font-medium text-slate-900">{place.name}</span>
              {place.detail && <span className="block text-xs text-slate-500">{place.detail}</span>}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-1 text-xs text-slate-500">{t("wizard.step1.stay.hint")}</p>
    </div>
  );
}
