import { redirect } from "next/navigation";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Welcome to MonkeyTravel",
  description: "Get started with your AI-powered travel planning journey",
};

// /welcome was retired — email + OAuth signups now land directly in the
// trip wizard (see app/[locale]/auth/signup/page.tsx and
// app/auth/callback/route.ts). We keep this route as a server-side
// redirect so any cached external links or stale push notifications
// continue to land somewhere useful instead of 404-ing.
//
// WelcomeClient.tsx is intentionally left in place as dead code; the
// folder cleanup is a separate task.
export default function WelcomePage(): never {
  redirect("/trips/new");
}
