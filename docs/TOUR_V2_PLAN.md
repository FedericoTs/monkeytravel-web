# Tour V2: Code-Rendered Implementation Plan

## Executive Summary

Replace screenshot-based tour with fully code-rendered components for:
- **Zero loading delays** (all UI in JS bundle)
- **Buttery-smooth 60fps animations** (GPU-accelerated)
- **Perfect element highlighting** (animate actual DOM elements)
- **Smaller bundle** (~50KB JS vs ~4MB images)

---

## 1. iOS-Style Aurora Background

### Design Concept: "Celestial Drift"

Inspired by iOS 18's dynamic wallpapers and Apple Music's ambient backgrounds. Multiple soft, translucent orbs that drift slowly, creating an organic, living atmosphere.

```
┌─────────────────────────────────────────────────────────────┐
│                    ╭─────╮                                  │
│               ╭───╯       ╰───╮                             │
│              ╱  CORAL GLOW    ╲      ╭─────────╮           │
│             │   (primary)      │    ╱   TEAL   ╲           │
│              ╲                 ╱   │   PULSE   │           │
│               ╰───╮       ╭───╯    ╲           ╱           │
│                   ╰─────╯          ╰─────────╯             │
│                                                             │
│         ╭───────────╮                                       │
│        ╱   GOLD     ╲                                       │
│       │   SHIMMER    │                                      │
│        ╲   (accent)  ╱                                      │
│         ╰───────────╯                                       │
│                                         ╭───────╮           │
│                                        ╱ CORAL  ╲          │
│                                       │  DRIFT   │          │
│                                        ╲        ╱           │
│                                         ╰──────╯            │
└─────────────────────────────────────────────────────────────┘
```

### Technical Implementation

**File: `components/tour/TourAuroraBackground.tsx`**

```typescript
// Orb configuration - each orb is a soft radial gradient
interface AuroraOrb {
  id: string;
  color: string;           // CSS color value
  size: number;            // Base size in vw units
  position: { x: string; y: string };
  animation: {
    x: [string, string];   // Keyframes for x drift
    y: [string, string];   // Keyframes for y drift
    scale: [number, number]; // Breathing scale
    duration: number;      // Animation duration in seconds
  };
  blur: number;            // Blur amount in px
  opacity: number;         // Base opacity
}

const AURORA_ORBS: AuroraOrb[] = [
  // Large coral orb - top left, drifts right
  {
    id: "coral-main",
    color: "rgba(255, 107, 107, 0.4)",  // --primary
    size: 60,
    position: { x: "-10%", y: "-20%" },
    animation: { x: ["-10%", "5%"], y: ["-20%", "-10%"], scale: [1, 1.1], duration: 20 },
    blur: 100,
    opacity: 0.6,
  },
  // Teal orb - center right, drifts up
  {
    id: "teal-pulse",
    color: "rgba(0, 180, 166, 0.35)",   // --secondary
    size: 45,
    position: { x: "60%", y: "20%" },
    animation: { x: ["60%", "55%"], y: ["20%", "10%"], scale: [1, 1.15], duration: 25 },
    blur: 80,
    opacity: 0.5,
  },
  // Gold accent orb - bottom center, subtle pulse
  {
    id: "gold-shimmer",
    color: "rgba(255, 217, 61, 0.3)",   // --accent
    size: 35,
    position: { x: "30%", y: "70%" },
    animation: { x: ["30%", "35%"], y: ["70%", "65%"], scale: [1, 1.2], duration: 18 },
    blur: 60,
    opacity: 0.4,
  },
  // Secondary coral - bottom right, slow drift
  {
    id: "coral-secondary",
    color: "rgba(255, 107, 107, 0.25)",
    size: 50,
    position: { x: "80%", y: "80%" },
    animation: { x: ["80%", "70%"], y: ["80%", "75%"], scale: [1, 1.08], duration: 30 },
    blur: 90,
    opacity: 0.35,
  },
  // Deep purple accent - subtle mystery
  {
    id: "purple-mist",
    color: "rgba(162, 155, 254, 0.2)",  // --vibe-cultural
    size: 40,
    position: { x: "10%", y: "50%" },
    animation: { x: ["10%", "20%"], y: ["50%", "45%"], scale: [1, 1.12], duration: 22 },
    blur: 70,
    opacity: 0.3,
  },
];
```

### CSS Animation Approach

```css
/* Smooth GPU-accelerated animation for orbs */
@keyframes aurora-drift {
  0%, 100% {
    transform: translate(var(--start-x), var(--start-y)) scale(var(--start-scale));
  }
  50% {
    transform: translate(var(--end-x), var(--end-y)) scale(var(--end-scale));
  }
}

.aurora-orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(var(--blur));
  opacity: var(--opacity);
  will-change: transform;
  animation: aurora-drift var(--duration) ease-in-out infinite;
}
```

### Circular Wave Effect (Ripples)

For additional iOS-style depth, add subtle concentric ring animations:

```typescript
// Rings that pulse outward from center
const RIPPLE_CONFIG = {
  count: 3,
  color: "rgba(255, 255, 255, 0.03)",
  maxRadius: "120vw",
  duration: 8, // seconds per cycle
  staggerDelay: 2.5, // seconds between each ring
};
```

---

## 2. Code-Rendered Phone Content Components

### File Structure

```
components/tour/
├── phone-content/
│   ├── PhoneScreen.tsx           # Phone frame wrapper (no Image)
│   ├── screens/
│   │   ├── DestinationScreen.tsx # Trip hero UI
│   │   ├── ItineraryScreen.tsx   # Activity cards UI
│   │   ├── MapScreen.tsx         # SVG map with pins
│   │   └── TemplatesScreen.tsx   # Template gallery UI
│   └── elements/
│       ├── ActivityCard.tsx      # Animated activity card
│       ├── TravelBadge.tsx       # Walking time badge
│       ├── TagPill.tsx           # Category tags
│       ├── MapPin.tsx            # Animated map marker
│       └── TemplateCard.tsx      # Mini template preview
```

### PhoneScreen Component

Renders a phone frame with internal React content instead of an image:

```tsx
interface PhoneScreenProps {
  children: React.ReactNode;
  variant?: "center" | "left" | "right";
  size?: "xs" | "sm" | "md" | "lg";
  highlightElement?: string;  // CSS selector for element to highlight
}

export function PhoneScreen({ children, highlightElement, ...props }: PhoneScreenProps) {
  return (
    <motion.div className="phone-frame">
      {/* Dynamic Island */}
      <div className="dynamic-island" />

      {/* Screen Content - React components render here */}
      <div className="screen-content">
        {children}

        {/* Highlight overlay - animated glow on specific element */}
        {highlightElement && (
          <HighlightOverlay selector={highlightElement} />
        )}
      </div>
    </motion.div>
  );
}
```

---

## 3. Screen Designs (Simplified but Recognizable)

### Screen 1: Destination (Trip Hero)

```
┌─────────────────────────────────┐
│  ← Back          Shared Trip 🔗 │  ← Fades in
│                                 │
│  Barcelona Trip                 │  ← Typewriter animation
│  A vibrant city known for...    │  ← Fades in after title
│                                 │
│  📅 Feb 12-21 | 10D 9N | 🎯 12  │  ← Stagger pop-in
│  💰 $442                        │
│                                 │
│  [culture] [history] [art]      │  ← Scale bounce in
│                                 │
│  ┌─────────────────────────┐    │
│  │ 🗺️ █████████████████   │    │  ← Gradient map preview
│  │    🔵 1 ─── 🔵 2 ─── 🔵 │    │  ← Pins drop animation
│  └─────────────────────────┘    │
│                                 │
│  🏠   📋   ➕   👤              │  ← Bottom nav fades in
└─────────────────────────────────┘
```

**Highlight: Title area (top section)**

### Screen 2: Itinerary (Activity Cards)

```
┌─────────────────────────────────┐
│  [All] [Day 1] [Day 2] [Day 3]  │  ← Tab slides in
│                                 │
│  ① Day 1                        │  ← Circle pops
│     Gothic Quarter Immersion    │
│                                 │
│  ┌───────────────────────────┐  │
│  │ 🏛️ 09:00 · 180 min       │  │  ← HIGHLIGHT + Glow
│  │ Barcelona Cathedral       │  │
│  │ Explore the stunning...   │  │
│  │ 📍 Pla de la Seu, s/n     │  │
│  │ [Maps] [Verify] [Website] │  │
│  └───────────────────────────┘  │
│         ↓ ~2 min · ~153m        │  ← Pulse animation
│  ┌───────────────────────────┐  │
│  │ 🍽️ 12:30 · 90 min        │  │  ← Slides in delayed
│  │ Can Culleretes [Booking]  │  │
│  └───────────────────────────┘  │
│                                 │
│  🏠   📋   ➕   👤              │
└─────────────────────────────────┘
```

**Highlight: First activity card with animated border**

### Screen 3: Map (SVG Visualization)

```
┌─────────────────────────────────┐
│           Barcelona             │
│                                 │
│  ┌───────────────────────────┐  │
│  │                           │  │
│  │      🔵 Cathedral         │  │  ← Pin drops with bounce
│  │        ╲                  │  │
│  │         ╲                 │  │  ← Path draws (SVG)
│  │          ╲                │  │
│  │      🟢 Can Culleretes    │  │  ← Second pin drops
│  │            ╲              │  │
│  │             ╲             │  │
│  │         🟡 Picasso Museum │  │  ← Third pin drops
│  │                           │  │
│  └───────────────────────────┘  │
│                                 │
│  📍 3 locations · 45 min walk   │  ← Fades in
│                                 │
│  🏠   📋   ➕   👤              │
└─────────────────────────────────┘
```

**Map is pure SVG** - gradient background, animated path stroke, bouncing pins.

### Screen 4: Templates (Gallery Grid)

```
┌─────────────────────────────────┐
│  ✨ Curated Escapes             │  ← Title shimmers
│                                 │
│  🔍 Search destinations...      │  ← Search bar fades in
│                                 │
│  ┌───────────────────────────┐  │
│  │ █████████████████████████ │  │
│  │ ██ PARIS ████████████████ │  │  ← HIGHLIGHT
│  │ ██ 🇫🇷 7 days ████████████ │  │
│  │ [Explore Itinerary →]     │  │
│  └───────────────────────────┘  │
│                                 │
│  ┌─────────────┐ ┌─────────────┐│
│  │ Tokyo 🇯🇵    │ │ Barcelona 🇪🇸││  ← Stagger in
│  │ 7 days     │ │ 5 days      ││
│  └─────────────┘ └─────────────┘│
│                                 │
│  🏠   📋   ➕   👤              │
└─────────────────────────────────┘
```

**Template cards use CSS gradients** with overlaid text, no images needed.

---

## 4. Animation Choreography

### Timeline per Slide (4 seconds auto-advance)

```
0.0s ─ Background orbs shift colors/positions
0.2s ─ Phone frame enters with spring physics
0.4s ─ Screen content begins rendering
0.6s ─ Primary elements animate in (title, main card)
1.0s ─ Secondary elements animate (features, badges)
1.5s ─ Highlight glow begins pulsing
2.0s ─ Subtle micro-interactions (hover states, pulses)
4.0s ─ Crossfade to next slide
```

### Transition Between Slides

```typescript
const slideTransition = {
  // Phone exits
  exit: {
    opacity: 0,
    x: -100,
    rotateY: -15,
    transition: { duration: 0.4, ease: "easeIn" }
  },
  // Next phone enters
  enter: {
    opacity: 0,
    x: 100,
    rotateY: 15,
  },
  animate: {
    opacity: 1,
    x: 0,
    rotateY: 0,
    transition: { duration: 0.6, ease: [0.25, 0.1, 0.25, 1] }
  }
};
```

### Highlight Animation (Element Glow)

```typescript
const highlightAnimation = {
  initial: { boxShadow: "0 0 0 0 rgba(255, 217, 61, 0)" },
  animate: {
    boxShadow: [
      "0 0 0 0 rgba(255, 217, 61, 0)",
      "0 0 0 4px rgba(255, 217, 61, 0.4)",
      "0 0 20px 8px rgba(255, 217, 61, 0.2)",
      "0 0 0 4px rgba(255, 217, 61, 0.4)",
      "0 0 0 0 rgba(255, 217, 61, 0)",
    ],
    transition: { duration: 2, repeat: Infinity, ease: "easeInOut" }
  }
};
```

---

## 5. Responsive Design

### Mobile (375px - 640px)

- Phone size: 140px width
- Single column layout
- Text content below phone
- Compact feature badges (emoji only)
- Bottom-aligned progress dots

### Tablet (641px - 1024px)

- Phone size: 200px width
- Two-column on landscape
- Feature cards visible
- Larger text

### Desktop (1025px+)

- Phone size: 260px-300px width
- Full two-column layout
- All features visible
- Premium animations enabled

---

## 6. Performance Projections

| Metric | Current (Images) | New (Code) | Improvement |
|--------|-----------------|------------|-------------|
| First Contentful Paint | 800-2000ms | <100ms | **8-20x faster** |
| Total Transfer Size | ~4MB | ~50KB | **80x smaller** |
| Network Requests | 13+ images | 0 additional | **100% reduction** |
| Animation FPS | Variable (30-60) | Consistent 60 | **Smooth** |
| Time to Interactive | Variable | Instant | **Immediate** |

---

## 7. Implementation Order

### Phase 1: Aurora Background (1 hour)
1. Create `TourAuroraBackground.tsx`
2. Add CSS keyframes for orb drift and ripples
3. Test on mobile/desktop

### Phase 2: Phone Screen Components (1.5 hours)
1. Create `PhoneScreen.tsx` (frame without Image)
2. Build `DestinationScreen.tsx`
3. Build `ItineraryScreen.tsx`
4. Build `MapScreen.tsx` (SVG-based)
5. Build `TemplatesScreen.tsx`

### Phase 3: Animation Polish (30 min)
1. Add highlight overlays
2. Fine-tune animation timing
3. Test transitions between slides

### Phase 4: Integration & Testing (30 min)
1. Update slide components to use new screens
2. Remove image preloading code
3. Test on mobile (375px) and desktop (1280px)
4. Build and deploy

---

## 8. Files to Create

| File | Purpose | Lines (est) |
|------|---------|------------|
| `TourAuroraBackground.tsx` | Animated gradient orbs | ~150 |
| `PhoneScreen.tsx` | Phone frame with React content | ~100 |
| `DestinationScreen.tsx` | Trip hero UI | ~120 |
| `ItineraryScreen.tsx` | Activity cards with timeline | ~180 |
| `MapScreen.tsx` | SVG map with animated pins | ~150 |
| `TemplatesScreen.tsx` | Gallery grid | ~120 |
| `ActivityCard.tsx` | Reusable card component | ~80 |
| `TravelBadge.tsx` | Walking time badge | ~40 |
| **Total** | | **~940 lines** |

---

## 9. Files to Modify

| File | Changes |
|------|---------|
| `TourBackground.tsx` | Replace with `TourAuroraBackground` |
| `SlideDestination.tsx` | Use `PhoneScreen` + `DestinationScreen` |
| `SlideItinerary.tsx` | Use `PhoneScreen` + `ItineraryScreen` |
| `SlideMap.tsx` | Use `PhoneScreen` + `MapScreen` |
| `SlideTemplates.tsx` | Use `PhoneScreen` + `TemplatesScreen` |
| `TourTrigger.tsx` | Remove image preloading code |
| `ProductTour.tsx` | Remove screenshot preloading |

---

## 10. Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Code-rendered UI doesn't look like real app | Keep styling minimal, focus on recognizable patterns |
| More code = more bundle size | Tree-shaking + lazy loading keeps impact minimal |
| Animations too heavy on mobile | Use `prefers-reduced-motion` + simpler mobile animations |
| Development takes longer than expected | Modular approach allows partial rollout |

---

## Ready to Implement?

This plan eliminates the entire class of image-loading problems by rendering everything in code. The aurora background creates a premium iOS feel, while the code-rendered phone content ensures instant, glitch-free animations.

Estimated total time: **3-4 hours**
Result: **Zero-loading, 60fps smooth tour**
