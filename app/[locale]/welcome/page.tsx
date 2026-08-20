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
// The old WelcomeClient.tsx was deleted 2026-08-20. Nothing imported it — the
// redirect above means it had not rendered since /welcome was retired — and it
// still advertised "1 AI-generated trip ready to use", a promise dropped when
// free-trip accounting was removed on 2026-05-23. Dead code that states
// something untrue is worse than dead code, because a future reader has no way
// to tell it is stale.
export default function WelcomePage(): never {
  redirect("/trips/new");
}
