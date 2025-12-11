// Main tour component
export { default as ProductTour } from "./ProductTour";

// Trigger component (client-side)
export { default as TourTrigger, useTourAutoShow } from "./TourTrigger";

// Sub-components (for custom implementations)
export { default as TourBackground } from "./TourBackground";
export { default as TourPhone, CascadePhone } from "./TourPhone";
export { default as TourProgress, AutoAdvanceBar } from "./TourProgress";

// Hooks
export { useTourNavigation } from "./hooks/useTourNavigation";
export { useReducedMotion } from "./hooks/useReducedMotion";

// Animation variants
export * from "./animations";

// Individual slides (if needed for customization)
export { default as SlideDestination } from "./slides/SlideDestination";
export { default as SlideItinerary } from "./slides/SlideItinerary";
export { default as SlideMap } from "./slides/SlideMap";
export { default as SlideTemplates } from "./slides/SlideTemplates";
export { default as SlideCTA } from "./slides/SlideCTA";
