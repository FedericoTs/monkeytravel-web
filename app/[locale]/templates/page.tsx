import { Metadata } from "next";
import TemplatesPageClient from "./TemplatesPageClient";

export const metadata: Metadata = {
  // Strip brand suffix on metadata.title — root layout adds it via template.
  // Keep brand on openGraph.title since social cards are seen out of context.
  title: "Curated Escapes",
  description:
    "Discover hand-picked travel itineraries crafted by travel experts. Browse curated trips to Paris, Tokyo, Barcelona, and more destinations worldwide.",
  openGraph: {
    title: "Curated Escapes | MonkeyTravel",
    description:
      "Discover hand-picked travel itineraries crafted by travel experts.",
    type: "website",
  },
};

export default function TemplatesPage() {
  return <TemplatesPageClient />;
}
