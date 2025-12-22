/**
 * OAuth Authorization Consent Page
 * Users are redirected here when ChatGPT requests access to their MonkeyTravel account
 *
 * Flow:
 * 1. Supabase redirects user here with authorization_id
 * 2. We fetch authorization details from Supabase
 * 3. User approves or denies access
 * 4. We call Supabase to approve/deny
 * 5. User is redirected back to ChatGPT with auth code
 */

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import OAuthConsentClient from "./OAuthConsentClient";

interface PageProps {
  searchParams: Promise<{ authorization_id?: string }>;
}

export const metadata = {
  title: "Authorize Access - MonkeyTravel",
  description: "Authorize an application to access your MonkeyTravel account",
};

export default async function OAuthAuthorizePage({ searchParams }: PageProps) {
  const { authorization_id } = await searchParams;

  if (!authorization_id) {
    redirect("/?error=missing_authorization_id");
  }

  const supabase = await createClient();

  // Check if user is authenticated
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    // Redirect to login with return URL
    const returnUrl = `/oauth/authorize?authorization_id=${authorization_id}`;
    redirect(`/login?returnUrl=${encodeURIComponent(returnUrl)}`);
  }

  // Get authorization details from Supabase
  // This tells us what app is requesting access and what scopes
  let authDetails = null;
  let authError = null;

  try {
    // Supabase OAuth API - check if available
    if (supabase.auth.oauth?.getAuthorizationDetails) {
      const result = await supabase.auth.oauth.getAuthorizationDetails(authorization_id);
      if (result.error) {
        authError = result.error.message;
      } else {
        authDetails = result.data;
      }
    } else {
      authError = "OAuth API not available. Please enable OAuth 2.1 in Supabase Dashboard.";
    }
  } catch (e) {
    authError =
      e instanceof Error ? e.message : "Failed to fetch authorization details";
  }

  if (authError || !authDetails) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md w-full p-8 bg-white rounded-2xl shadow-lg text-center">
          <h1 className="text-2xl font-bold text-red-600 mb-4">
            Authorization Error
          </h1>
          <p className="text-gray-600 mb-6">
            {authError || "Unable to load authorization details."}
          </p>
          <a
            href="/"
            className="inline-block px-6 py-3 bg-[var(--primary)] text-white rounded-lg hover:bg-[#083d5c] transition-colors"
          >
            Return Home
          </a>
        </div>
      </div>
    );
  }

  // Parse scope string to array (OAuth 2.1 uses space-separated scopes)
  const scopeString = authDetails.scope || "";
  const scopesArray = scopeString ? scopeString.split(" ").filter(Boolean) : [];

  // Cast client to access description which may not be in the official types
  const clientData = authDetails.client as { name?: string; description?: string } | undefined;

  return (
    <OAuthConsentClient
      authorizationId={authorization_id}
      clientName={clientData?.name || "Unknown App"}
      clientDescription={clientData?.description}
      scopes={scopesArray}
      userEmail={user.email || ""}
    />
  );
}
