# Frontend Design Skill

A comprehensive design system and component library for MonkeyTravel's AI-powered travel planning interface.

## Design Philosophy

1. **Premium but Approachable** - Luxury feel without intimidation
2. **Mobile-First** - 60%+ users expected on mobile
3. **Progressive Disclosure** - Show complexity gradually
4. **Instant Feedback** - Every action has visual response
5. **Trust & Clarity** - AI features are transparent

---

## Color System

### Brand Colors

```css
/* globals.css - Already defined */
:root {
  /* Primary Brand */
  --primary: #0A4B73;        /* Deep ocean blue - trust, travel */
  --primary-light: #1A6B9A;  /* Hover state */
  --primary-dark: #033254;   /* Active/pressed state */

  /* Accent */
  --accent: #F2C641;         /* Golden yellow - excitement, warmth */
  --accent-light: #FFD966;   /* Hover */
  --accent-dark: #D4A82F;    /* Active */

  /* Neutral */
  --navy: #0f172a;           /* Dark backgrounds */
  --slate-900: #1e293b;
  --slate-800: #334155;
  --slate-600: #475569;
  --slate-400: #94a3b8;
  --slate-200: #e2e8f0;
  --slate-100: #f1f5f9;
  --white: #ffffff;

  /* Semantic */
  --success: #10B981;
  --warning: #F59E0B;
  --error: #EF4444;
  --info: #3B82F6;

  /* Gradients */
  --gradient-primary: linear-gradient(135deg, var(--primary) 0%, var(--primary-light) 100%);
  --gradient-warm: linear-gradient(135deg, var(--accent) 0%, #F97316 100%);
  --gradient-hero: linear-gradient(180deg, var(--slate-100) 0%, var(--white) 100%);
}
```

### Dark Mode (Optional for POC)

```css
.dark {
  --background: var(--navy);
  --foreground: var(--white);
  --card: var(--slate-900);
  --card-border: var(--slate-800);
  --muted: var(--slate-600);
}
```

---

## Typography

```css
/* Font scale */
:root {
  --font-sans: var(--font-geist-sans), system-ui, sans-serif;
  --font-mono: var(--font-geist-mono), monospace;

  /* Sizes */
  --text-xs: 0.75rem;     /* 12px */
  --text-sm: 0.875rem;    /* 14px */
  --text-base: 1rem;      /* 16px */
  --text-lg: 1.125rem;    /* 18px */
  --text-xl: 1.25rem;     /* 20px */
  --text-2xl: 1.5rem;     /* 24px */
  --text-3xl: 1.875rem;   /* 30px */
  --text-4xl: 2.25rem;    /* 36px */
  --text-5xl: 3rem;       /* 48px */

  /* Line heights */
  --leading-tight: 1.2;
  --leading-normal: 1.5;
  --leading-relaxed: 1.75;
}

/* Heading styles */
.heading-1 {
  font-size: var(--text-4xl);
  font-weight: 700;
  line-height: var(--leading-tight);
  letter-spacing: -0.02em;
}

.heading-2 {
  font-size: var(--text-3xl);
  font-weight: 600;
  line-height: var(--leading-tight);
}

.heading-3 {
  font-size: var(--text-2xl);
  font-weight: 600;
  line-height: var(--leading-normal);
}

.body-large {
  font-size: var(--text-lg);
  line-height: var(--leading-relaxed);
}

.body-base {
  font-size: var(--text-base);
  line-height: var(--leading-normal);
}

.caption {
  font-size: var(--text-sm);
  color: var(--slate-600);
}
```

---

## Component Library

### Button Component

```tsx
// components/ui/Button.tsx

import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "outline" | "ghost" | "accent";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  icon?: React.ReactNode;
}

export function Button({
  children,
  variant = "primary",
  size = "md",
  loading = false,
  icon,
  className,
  disabled,
  ...props
}: ButtonProps) {
  const variants = {
    primary: "bg-[var(--primary)] text-white hover:bg-[var(--primary-light)] active:bg-[var(--primary-dark)]",
    secondary: "bg-slate-100 text-slate-900 hover:bg-slate-200 active:bg-slate-300",
    outline: "border-2 border-[var(--primary)] text-[var(--primary)] hover:bg-[var(--primary)] hover:text-white",
    ghost: "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
    accent: "bg-[var(--accent)] text-slate-900 hover:bg-[var(--accent-light)] active:bg-[var(--accent-dark)]",
  };

  const sizes = {
    sm: "px-3 py-1.5 text-sm",
    md: "px-4 py-2 text-base",
    lg: "px-6 py-3 text-lg",
  };

  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium",
        "transition-all duration-200 ease-out",
        "focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        variants[variant],
        sizes[size],
        className
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : icon ? (
        icon
      ) : null}
      {children}
    </button>
  );
}
```

### Input Component

```tsx
// components/ui/Input.tsx

import { cn } from "@/lib/utils";
import { forwardRef } from "react";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  icon?: React.ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, icon, className, ...props }, ref) => {
    return (
      <div className="space-y-1.5">
        {label && (
          <label className="block text-sm font-medium text-slate-700">
            {label}
          </label>
        )}
        <div className="relative">
          {icon && (
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
              {icon}
            </div>
          )}
          <input
            ref={ref}
            className={cn(
              "w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5",
              "text-slate-900 placeholder:text-slate-400",
              "focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20",
              "transition-colors duration-200",
              "disabled:bg-slate-50 disabled:cursor-not-allowed",
              icon && "pl-10",
              error && "border-red-500 focus:border-red-500 focus:ring-red-500/20",
              className
            )}
            {...props}
          />
        </div>
        {error && (
          <p className="text-sm text-red-500">{error}</p>
        )}
      </div>
    );
  }
);

Input.displayName = "Input";
```

### Card Component

```tsx
// components/ui/Card.tsx

import { cn } from "@/lib/utils";

interface CardProps {
  children: React.ReactNode;
  className?: string;
  hover?: boolean;
  padding?: "sm" | "md" | "lg";
}

export function Card({
  children,
  className,
  hover = false,
  padding = "md",
}: CardProps) {
  const paddings = {
    sm: "p-4",
    md: "p-6",
    lg: "p-8",
  };

  return (
    <div
      className={cn(
        "bg-white rounded-xl border border-slate-200",
        "shadow-sm",
        hover && "transition-all duration-200 hover:shadow-md hover:border-slate-300",
        paddings[padding],
        className
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("mb-4", className)}>
      {children}
    </div>
  );
}

export function CardTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <h3 className={cn("text-xl font-semibold text-slate-900", className)}>
      {children}
    </h3>
  );
}

export function CardDescription({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={cn("text-slate-600 mt-1", className)}>
      {children}
    </p>
  );
}
```

### Badge/Chip Component

```tsx
// components/ui/Badge.tsx

import { cn } from "@/lib/utils";

interface BadgeProps {
  children: React.ReactNode;
  variant?: "default" | "primary" | "success" | "warning" | "error" | "outline";
  size?: "sm" | "md";
  className?: string;
}

export function Badge({
  children,
  variant = "default",
  size = "md",
  className,
}: BadgeProps) {
  const variants = {
    default: "bg-slate-100 text-slate-700",
    primary: "bg-[var(--primary)]/10 text-[var(--primary)]",
    success: "bg-green-100 text-green-700",
    warning: "bg-amber-100 text-amber-700",
    error: "bg-red-100 text-red-700",
    outline: "border border-slate-300 text-slate-600 bg-transparent",
  };

  const sizes = {
    sm: "px-2 py-0.5 text-xs",
    md: "px-2.5 py-1 text-sm",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center font-medium rounded-full",
        variants[variant],
        sizes[size],
        className
      )}
    >
      {children}
    </span>
  );
}
```

---

## Trip Planning Components

### DestinationSearch (Autocomplete)

```tsx
// components/trips/DestinationSearch.tsx

import { useState, useEffect, useRef } from "react";
import { Input } from "@/components/ui/Input";
import { MapPin, Loader2 } from "lucide-react";

interface Destination {
  name: string;
  country: string;
  code?: string;
}

interface DestinationSearchProps {
  value: string;
  onChange: (value: string, destination?: Destination) => void;
  placeholder?: string;
}

export function DestinationSearch({
  value,
  onChange,
  placeholder = "Where do you want to go?",
}: DestinationSearchProps) {
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState<Destination[]>([]);
  const [loading, setLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(async () => {
      if (query.length >= 2) {
        setLoading(true);
        try {
          const res = await fetch(`/api/destinations/search?q=${encodeURIComponent(query)}`);
          const data = await res.json();
          setResults(data.destinations || []);
          setIsOpen(true);
        } catch {
          setResults([]);
        }
        setLoading(false);
      } else {
        setResults([]);
        setIsOpen(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query]);

  // Click outside handler
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={wrapperRef} className="relative">
      <Input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          onChange(e.target.value);
        }}
        placeholder={placeholder}
        icon={loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <MapPin className="w-4 h-4" />}
      />

      {isOpen && results.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-white rounded-lg border border-slate-200 shadow-lg overflow-hidden">
          {results.map((dest, i) => (
            <button
              key={i}
              className="w-full px-4 py-3 text-left hover:bg-slate-50 flex items-center gap-3 transition-colors"
              onClick={() => {
                setQuery(`${dest.name}, ${dest.country}`);
                onChange(`${dest.name}, ${dest.country}`, dest);
                setIsOpen(false);
              }}
            >
              <MapPin className="w-4 h-4 text-slate-400" />
              <div>
                <div className="font-medium text-slate-900">{dest.name}</div>
                <div className="text-sm text-slate-500">{dest.country}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

### DateRangePicker

```tsx
// components/trips/DateRangePicker.tsx

import { useState } from "react";
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

interface DateRangePickerProps {
  startDate: Date | null;
  endDate: Date | null;
  onChange: (start: Date | null, end: Date | null) => void;
  minDate?: Date;
  maxDays?: number;
}

export function DateRangePicker({
  startDate,
  endDate,
  onChange,
  minDate = new Date(),
  maxDays = 7,
}: DateRangePickerProps) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [isOpen, setIsOpen] = useState(false);

  // ... calendar logic

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "w-full flex items-center gap-3 px-4 py-2.5",
          "rounded-lg border border-slate-300 bg-white",
          "text-left hover:border-slate-400 transition-colors",
          isOpen && "border-[var(--primary)] ring-2 ring-[var(--primary)]/20"
        )}
      >
        <Calendar className="w-4 h-4 text-slate-400" />
        <span className={cn(startDate ? "text-slate-900" : "text-slate-400")}>
          {startDate && endDate
            ? `${formatDate(startDate)} - ${formatDate(endDate)}`
            : "Select dates"}
        </span>
      </button>

      {isOpen && (
        <div className="absolute z-50 mt-2 p-4 bg-white rounded-xl border border-slate-200 shadow-xl">
          {/* Calendar UI */}
          <div className="text-center text-sm text-slate-500 mt-2">
            Maximum {maxDays} days for POC
          </div>
        </div>
      )}
    </div>
  );
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
```

### BudgetSelector

```tsx
// components/trips/BudgetSelector.tsx

import { cn } from "@/lib/utils";
import { Wallet, DollarSign, Crown } from "lucide-react";

type BudgetTier = "budget" | "balanced" | "premium";

interface BudgetSelectorProps {
  value: BudgetTier;
  onChange: (tier: BudgetTier) => void;
}

const TIERS = [
  {
    id: "budget" as const,
    label: "Budget",
    description: "Free attractions, street food, public transport",
    range: "< $100/day",
    icon: Wallet,
    color: "text-green-600",
    bgColor: "bg-green-50",
    borderColor: "border-green-500",
  },
  {
    id: "balanced" as const,
    label: "Balanced",
    description: "Mix of experiences, local restaurants, some tours",
    range: "$100-250/day",
    icon: DollarSign,
    color: "text-blue-600",
    bgColor: "bg-blue-50",
    borderColor: "border-blue-500",
  },
  {
    id: "premium" as const,
    label: "Premium",
    description: "Skip-the-line, fine dining, private tours",
    range: "$250+/day",
    icon: Crown,
    color: "text-amber-600",
    bgColor: "bg-amber-50",
    borderColor: "border-amber-500",
  },
];

export function BudgetSelector({ value, onChange }: BudgetSelectorProps) {
  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-slate-700">
        Budget preference
      </label>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {TIERS.map((tier) => {
          const Icon = tier.icon;
          const isSelected = value === tier.id;

          return (
            <button
              key={tier.id}
              onClick={() => onChange(tier.id)}
              className={cn(
                "p-4 rounded-xl border-2 text-left transition-all duration-200",
                isSelected
                  ? `${tier.borderColor} ${tier.bgColor}`
                  : "border-slate-200 hover:border-slate-300"
              )}
            >
              <div className="flex items-center gap-2 mb-2">
                <Icon className={cn("w-5 h-5", tier.color)} />
                <span className="font-semibold text-slate-900">{tier.label}</span>
              </div>
              <p className="text-sm text-slate-600 mb-2">{tier.description}</p>
              <p className={cn("text-sm font-medium", tier.color)}>{tier.range}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

### InterestTags

```tsx
// components/trips/InterestTags.tsx

import { cn } from "@/lib/utils";

const INTERESTS = [
  { id: "culture", label: "Culture & Museums", emoji: "🏛️" },
  { id: "food", label: "Food & Dining", emoji: "🍽️" },
  { id: "nature", label: "Nature & Parks", emoji: "🌿" },
  { id: "adventure", label: "Adventure", emoji: "🎯" },
  { id: "relaxation", label: "Relaxation", emoji: "🧘" },
  { id: "nightlife", label: "Nightlife", emoji: "🌙" },
  { id: "shopping", label: "Shopping", emoji: "🛍️" },
  { id: "history", label: "History", emoji: "📜" },
  { id: "art", label: "Art & Design", emoji: "🎨" },
  { id: "photography", label: "Photography", emoji: "📸" },
];

interface InterestTagsProps {
  selected: string[];
  onChange: (interests: string[]) => void;
  max?: number;
}

export function InterestTags({ selected, onChange, max = 5 }: InterestTagsProps) {
  const toggle = (id: string) => {
    if (selected.includes(id)) {
      onChange(selected.filter((i) => i !== id));
    } else if (selected.length < max) {
      onChange([...selected, id]);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="block text-sm font-medium text-slate-700">
          What interests you?
        </label>
        <span className="text-sm text-slate-500">
          {selected.length}/{max} selected
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {INTERESTS.map((interest) => {
          const isSelected = selected.includes(interest.id);
          const isDisabled = !isSelected && selected.length >= max;

          return (
            <button
              key={interest.id}
              onClick={() => !isDisabled && toggle(interest.id)}
              disabled={isDisabled}
              className={cn(
                "px-3 py-2 rounded-full text-sm font-medium",
                "transition-all duration-200",
                "flex items-center gap-1.5",
                isSelected
                  ? "bg-[var(--primary)] text-white"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200",
                isDisabled && "opacity-50 cursor-not-allowed"
              )}
            >
              <span>{interest.emoji}</span>
              <span>{interest.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

---

## Itinerary Display Components

### DayTimeline

```tsx
// components/itinerary/DayTimeline.tsx

import { Activity } from "@/types/itinerary";
import { ActivityCard } from "./ActivityCard";
import { Sun, Sunset, Moon } from "lucide-react";

interface DayTimelineProps {
  dayNumber: number;
  date: string;
  theme: string;
  activities: Activity[];
}

const TIME_SLOTS = [
  { id: "morning", label: "Morning", icon: Sun, color: "text-amber-500" },
  { id: "afternoon", label: "Afternoon", icon: Sunset, color: "text-orange-500" },
  { id: "evening", label: "Evening", icon: Moon, color: "text-indigo-500" },
] as const;

export function DayTimeline({ dayNumber, date, theme, activities }: DayTimelineProps) {
  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-US", {
      weekday: "long",
      month: "short",
      day: "numeric",
    });
  };

  return (
    <div className="space-y-6">
      {/* Day header */}
      <div className="flex items-center gap-4">
        <div className="flex-shrink-0 w-12 h-12 rounded-full bg-[var(--primary)] text-white flex items-center justify-center font-bold text-lg">
          {dayNumber}
        </div>
        <div>
          <h3 className="text-lg font-semibold text-slate-900">{formatDate(date)}</h3>
          <p className="text-slate-600">{theme}</p>
        </div>
      </div>

      {/* Timeline */}
      <div className="space-y-8 ml-6 pl-6 border-l-2 border-slate-200">
        {TIME_SLOTS.map((slot) => {
          const slotActivities = activities.filter((a) => a.time_slot === slot.id);
          if (slotActivities.length === 0) return null;

          const Icon = slot.icon;

          return (
            <div key={slot.id} className="relative">
              {/* Connector dot */}
              <div className="absolute -left-[31px] w-4 h-4 rounded-full bg-white border-2 border-slate-300" />

              {/* Time slot header */}
              <div className="flex items-center gap-2 mb-4">
                <Icon className={cn("w-5 h-5", slot.color)} />
                <h4 className="font-medium text-slate-700">{slot.label}</h4>
              </div>

              {/* Activities */}
              <div className="space-y-3">
                {slotActivities.map((activity, i) => (
                  <ActivityCard key={i} activity={activity} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

### ActivityCard

```tsx
// components/itinerary/ActivityCard.tsx

import { Activity } from "@/types/itinerary";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import {
  Clock,
  MapPin,
  DollarSign,
  Info,
  Calendar,
  Utensils,
  Camera,
  Bus,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface ActivityCardProps {
  activity: Activity;
}

const TYPE_CONFIG = {
  attraction: { icon: Camera, color: "text-blue-500", bg: "bg-blue-50" },
  restaurant: { icon: Utensils, color: "text-orange-500", bg: "bg-orange-50" },
  activity: { icon: Calendar, color: "text-green-500", bg: "bg-green-50" },
  transport: { icon: Bus, color: "text-purple-500", bg: "bg-purple-50" },
};

const COST_TIER_COLORS = {
  free: "success",
  budget: "primary",
  moderate: "warning",
  expensive: "error",
} as const;

export function ActivityCard({ activity }: ActivityCardProps) {
  const typeConfig = TYPE_CONFIG[activity.type];
  const Icon = typeConfig.icon;

  const formatTime = (time: string) => {
    const [hours, minutes] = time.split(":");
    const h = parseInt(hours);
    const ampm = h >= 12 ? "PM" : "AM";
    const hour12 = h % 12 || 12;
    return `${hour12}:${minutes} ${ampm}`;
  };

  return (
    <Card hover className="relative overflow-hidden">
      {/* Type indicator strip */}
      <div className={cn("absolute left-0 top-0 bottom-0 w-1", typeConfig.bg)} />

      <div className="flex gap-4">
        {/* Icon */}
        <div className={cn("flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center", typeConfig.bg)}>
          <Icon className={cn("w-5 h-5", typeConfig.color)} />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Header */}
          <div className="flex items-start justify-between gap-2 mb-2">
            <h4 className="font-semibold text-slate-900">{activity.name}</h4>
            {activity.booking_required && (
              <Badge variant="warning" size="sm">
                Booking needed
              </Badge>
            )}
          </div>

          {/* Meta row */}
          <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600 mb-2">
            <div className="flex items-center gap-1">
              <Clock className="w-4 h-4" />
              <span>{formatTime(activity.start_time)}</span>
              <span className="text-slate-400">({activity.duration_minutes}min)</span>
            </div>
            <div className="flex items-center gap-1">
              <DollarSign className="w-4 h-4" />
              <span>
                {activity.estimated_cost.amount === 0
                  ? "Free"
                  : `${activity.estimated_cost.currency} ${activity.estimated_cost.amount}`}
              </span>
              <Badge variant={COST_TIER_COLORS[activity.estimated_cost.tier]} size="sm">
                {activity.estimated_cost.tier}
              </Badge>
            </div>
          </div>

          {/* Description */}
          <p className="text-slate-600 mb-2">{activity.description}</p>

          {/* Location */}
          <div className="flex items-center gap-1 text-sm text-slate-500">
            <MapPin className="w-4 h-4" />
            <span>{activity.location}</span>
          </div>

          {/* Tips */}
          {activity.tips.length > 0 && (
            <div className="mt-3 p-2 bg-slate-50 rounded-lg">
              <div className="flex items-center gap-1 text-xs font-medium text-slate-500 mb-1">
                <Info className="w-3 h-3" />
                Tips
              </div>
              <ul className="text-sm text-slate-600 space-y-0.5">
                {activity.tips.map((tip, i) => (
                  <li key={i}>• {tip}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
```

---

## Loading States

### GenerationLoader

```tsx
// components/ai/GenerationLoader.tsx

import { useState, useEffect } from "react";
import { Loader2, Check, MapPin, Utensils, Calendar, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

const STEPS = [
  { id: "analyzing", label: "Analyzing destination", icon: MapPin },
  { id: "activities", label: "Finding best activities", icon: Calendar },
  { id: "restaurants", label: "Selecting restaurants", icon: Utensils },
  { id: "optimizing", label: "Optimizing your schedule", icon: Sparkles },
];

interface GenerationLoaderProps {
  progress?: number; // 0-100
}

export function GenerationLoader({ progress = 0 }: GenerationLoaderProps) {
  const [currentStep, setCurrentStep] = useState(0);

  // Simulate progress through steps
  useEffect(() => {
    if (progress >= 25) setCurrentStep(1);
    if (progress >= 50) setCurrentStep(2);
    if (progress >= 75) setCurrentStep(3);
    if (progress >= 95) setCurrentStep(4);
  }, [progress]);

  return (
    <div className="flex flex-col items-center justify-center py-12">
      {/* Animated icon */}
      <div className="relative mb-8">
        <div className="w-20 h-20 rounded-full bg-[var(--primary)]/10 flex items-center justify-center">
          <Sparkles className="w-10 h-10 text-[var(--primary)] animate-pulse" />
        </div>
        <div className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-[var(--accent)] flex items-center justify-center">
          <Loader2 className="w-4 h-4 text-slate-900 animate-spin" />
        </div>
      </div>

      {/* Title */}
      <h3 className="text-xl font-semibold text-slate-900 mb-2">
        Creating your perfect trip...
      </h3>
      <p className="text-slate-600 mb-8">
        This usually takes 10-20 seconds
      </p>

      {/* Progress bar */}
      <div className="w-full max-w-md mb-8">
        <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
          <div
            className="h-full bg-[var(--primary)] rounded-full transition-all duration-500 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="text-center text-sm text-slate-500 mt-2">
          {progress}%
        </div>
      </div>

      {/* Steps */}
      <div className="space-y-3">
        {STEPS.map((step, i) => {
          const Icon = step.icon;
          const isDone = i < currentStep;
          const isCurrent = i === currentStep;

          return (
            <div
              key={step.id}
              className={cn(
                "flex items-center gap-3 transition-opacity duration-300",
                i > currentStep && "opacity-30"
              )}
            >
              <div
                className={cn(
                  "w-6 h-6 rounded-full flex items-center justify-center transition-colors duration-300",
                  isDone
                    ? "bg-green-500 text-white"
                    : isCurrent
                    ? "bg-[var(--primary)] text-white"
                    : "bg-slate-200 text-slate-400"
                )}
              >
                {isDone ? (
                  <Check className="w-4 h-4" />
                ) : isCurrent ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Icon className="w-3 h-3" />
                )}
              </div>
              <span
                className={cn(
                  "text-sm",
                  isDone
                    ? "text-green-600"
                    : isCurrent
                    ? "text-slate-900 font-medium"
                    : "text-slate-400"
                )}
              >
                {step.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

---

## Page Layouts

### Trip Creation Wizard Layout

```tsx
// app/trips/new/page.tsx (structure)

export default function NewTripPage() {
  const [step, setStep] = useState(1);
  const TOTAL_STEPS = 3;

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-lg border-b border-slate-200">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between">
          <button className="text-slate-600 hover:text-slate-900">
            ← Back
          </button>
          <div className="flex items-center gap-2">
            {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
              <div
                key={i}
                className={cn(
                  "h-1.5 rounded-full transition-all duration-300",
                  i + 1 <= step
                    ? "bg-[var(--primary)] w-8"
                    : "bg-slate-200 w-4"
                )}
              />
            ))}
          </div>
          <div className="text-sm text-slate-500">
            {step}/{TOTAL_STEPS}
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-2xl mx-auto px-4 py-8">
        {step === 1 && <DestinationStep onNext={() => setStep(2)} />}
        {step === 2 && <DatesStep onNext={() => setStep(3)} onBack={() => setStep(1)} />}
        {step === 3 && <PreferencesStep onBack={() => setStep(2)} />}
      </main>
    </div>
  );
}
```

### Itinerary View Layout

```tsx
// app/trips/[id]/page.tsx (structure)

export default function TripDetailPage() {
  return (
    <div className="min-h-screen bg-slate-50">
      {/* Hero header with destination image */}
      <div className="relative h-48 md:h-64 bg-gradient-to-br from-[var(--primary)] to-[var(--primary-dark)]">
        <div className="absolute inset-0 bg-black/20" />
        <div className="absolute bottom-0 left-0 right-0 p-6">
          <h1 className="text-3xl font-bold text-white">Paris, France</h1>
          <p className="text-white/80">Dec 15-17, 2025 • 3 days</p>
        </div>
      </div>

      {/* Action bar */}
      <div className="sticky top-0 z-40 bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Badge variant="success">AI Generated</Badge>
            <span className="text-slate-600">Est. €450</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm">Edit</Button>
            <Button variant="outline" size="sm">Share</Button>
          </div>
        </div>
      </div>

      {/* Day tabs */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-4xl mx-auto px-4">
          <div className="flex gap-1 overflow-x-auto">
            {days.map((day, i) => (
              <button
                key={i}
                className={cn(
                  "px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors",
                  i === activeDay
                    ? "border-[var(--primary)] text-[var(--primary)]"
                    : "border-transparent text-slate-600 hover:text-slate-900"
                )}
              >
                Day {i + 1}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Timeline content */}
      <main className="max-w-4xl mx-auto px-4 py-8">
        <DayTimeline {...days[activeDay]} />
      </main>

      {/* Budget summary footer */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 p-4 md:hidden">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-slate-600">Today's budget</div>
            <div className="font-semibold text-slate-900">€150</div>
          </div>
          <Button size="sm">View breakdown</Button>
        </div>
      </div>
    </div>
  );
}
```

---

## Utility Functions

```typescript
// lib/utils.ts

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Install dependencies:
// npm install clsx tailwind-merge
```

---

## Responsive Breakpoints

```css
/* Tailwind defaults used consistently */
/* sm: 640px  - Mobile landscape */
/* md: 768px  - Tablet */
/* lg: 1024px - Laptop */
/* xl: 1280px - Desktop */

/* Mobile-first approach throughout */
.container {
  @apply px-4 mx-auto max-w-4xl;
}

/* Responsive patterns */
.grid-responsive {
  @apply grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4;
}
```

---

## Animations

```css
/* globals.css additions */

@keyframes float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-10px); }
}

@keyframes pulse-glow {
  0%, 100% { box-shadow: 0 0 0 0 rgba(10, 75, 115, 0.4); }
  50% { box-shadow: 0 0 20px 10px rgba(10, 75, 115, 0); }
}

@keyframes slide-up {
  from { transform: translateY(10px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

.animate-float {
  animation: float 3s ease-in-out infinite;
}

.animate-pulse-glow {
  animation: pulse-glow 2s ease-in-out infinite;
}

.animate-slide-up {
  animation: slide-up 0.3s ease-out forwards;
}
```

---

## Dependencies

```bash
npm install clsx tailwind-merge lucide-react
```

---

*Skill Version: 1.0*
*Design System: MonkeyTravel Premium*
*Compatible with: Next.js 14+, Tailwind CSS 4*
