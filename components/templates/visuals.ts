/** The emoji shown next to each template mood. */
export const MOOD_EMOJIS: Record<string, string> = {
  romantic: "💕",
  adventure: "🏔️",
  cultural: "🏛️",
  relaxation: "🌴",
  foodie: "🍝",
  family: "👨‍👩‍👧‍👦",
  nature: "🌿",
  offbeat: "🧭",
  urban: "🏙️",
  wellness: "🧘",
};

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

/** A template card's background gradient: by city ("Paris, France" → Paris), grey otherwise. */
export function destinationGradient(destination: string): { from: string; to: string } {
  const key = destination.toLowerCase().split(",")[0].trim();
  return DESTINATION_GRADIENTS[key] || DESTINATION_GRADIENTS.default;
}
