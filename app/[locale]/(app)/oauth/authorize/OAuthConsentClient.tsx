"use client";

/**
 * OAuth Consent Client Component
 * Handles the approve/deny UI and actions
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Image from "next/image";

interface Props {
  authorizationId: string;
  clientName: string;
  clientDescription?: string;
  scopes: string[];
  userEmail: string;
}

// Scope descriptions for user-friendly display
const SCOPE_DESCRIPTIONS: Record<string, string> = {
  openid: "Verify your identity",
  email: "View your email address",
  profile: "View your profile information",
  "trips:read": "View your trips and itineraries",
  "trips:write": "Create and modify trips",
};

export default function OAuthConsentClient({
  authorizationId,
  clientName,
  clientDescription,
  scopes,
  userEmail,
}: Props) {
  const router = useRouter();
  const supabase = createClient();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleApprove = async () => {
    setIsLoading(true);
    setError(null);

    try {
      if (!supabase.auth.oauth?.approveAuthorization) {
        throw new Error("OAuth API not available");
      }

      const { error: approveError } = await supabase.auth.oauth.approveAuthorization(authorizationId);

      if (approveError) {
        throw new Error(approveError.message);
      }

      // Supabase will handle the redirect back to the client
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to approve access");
      setIsLoading(false);
    }
  };

  const handleDeny = async () => {
    setIsLoading(true);
    setError(null);

    try {
      if (!supabase.auth.oauth?.denyAuthorization) {
        throw new Error("OAuth API not available");
      }

      const { error: denyError } = await supabase.auth.oauth.denyAuthorization(authorizationId);

      if (denyError) {
        throw new Error(denyError.message);
      }

      // Redirect to home after denial
      router.push("/?auth=denied");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to deny access");
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-blue-50 to-white p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl overflow-hidden">
        {/* Header */}
        <div className="bg-[var(--primary)] p-6 text-white text-center">
          <Image
            src="/images/logo.png"
            alt="MonkeyTravel"
            width={60}
            height={60}
            className="mx-auto mb-3 rounded-xl"
          />
          <h1 className="text-xl font-bold">Authorize Access</h1>
        </div>

        {/* Content */}
        <div className="p-6">
          {/* Client Info */}
          <div className="text-center mb-6">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <svg
                className="w-8 h-8 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-gray-900">{clientName}</h2>
            {clientDescription && (
              <p className="text-sm text-gray-500 mt-1">{clientDescription}</p>
            )}
          </div>

          {/* What they can access */}
          <div className="mb-6">
            <p className="text-sm text-gray-600 mb-3">
              <strong>{clientName}</strong> wants to access your MonkeyTravel
              account as <strong>{userEmail}</strong>:
            </p>

            <ul className="space-y-2">
              {scopes.map((scope) => (
                <li key={scope} className="flex items-center text-sm text-gray-700">
                  <svg
                    className="w-4 h-4 text-green-500 mr-2 flex-shrink-0"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                  {SCOPE_DESCRIPTIONS[scope] || scope}
                </li>
              ))}
            </ul>
          </div>

          {/* Error */}
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={handleDeny}
              disabled={isLoading}
              className="flex-1 px-4 py-3 border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              Deny
            </button>
            <button
              onClick={handleApprove}
              disabled={isLoading}
              className="flex-1 px-4 py-3 bg-[var(--primary)] text-white rounded-lg font-medium hover:bg-[#083d5c] transition-colors disabled:opacity-50 flex items-center justify-center"
            >
              {isLoading ? (
                <svg
                  className="animate-spin h-5 w-5"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
              ) : (
                "Approve"
              )}
            </button>
          </div>

          {/* Trust notice */}
          <p className="mt-4 text-xs text-gray-400 text-center">
            Only authorize apps you trust. You can revoke access anytime from
            your account settings.
          </p>
        </div>
      </div>
    </div>
  );
}
