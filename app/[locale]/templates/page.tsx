import { Metadata } from "next";
import TemplatesPageClient from "./TemplatesPageClient";

export const metadata: Metadata = {
  title: "Curated Escapes | MonkeyTravel",
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
