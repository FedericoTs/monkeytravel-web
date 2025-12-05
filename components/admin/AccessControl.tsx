"use client";

import { useEffect, useState, useCallback } from "react";
import type { SiteConfig } from "@/app/api/admin/config/route";

export default function AccessControl() {
  const [config, setConfig] = useState<SiteConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form state
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [maintenanceTitle, setMaintenanceTitle] = useState("Under Maintenance");
  const [maintenanceMessage, setMaintenanceMessage] = useState("");
  const [allowedEmails, setAllowedEmails] = useState("");

  const fetchConfig = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/admin/config");
      if (!response.ok) throw new Error("Failed to fetch config");
      const data = await response.json();
      setConfig(data);

      // Populate form
      setMaintenanceMode(data.maintenance_mode || false);
      setMaintenanceTitle(data.maintenance_title || "Under Maintenance");
      setMaintenanceMessage(data.maintenance_message || "");
      setAllowedEmails((data.allowed_emails || []).join("\n"));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      setSuccess(null);

      const response = await fetch("/api/admin/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          maintenance_mode: maintenanceMode,
          maintenance_title: maintenanceTitle,
          maintenance_message: maintenanceMessage,
          allowed_emails: allowedEmails
            .split("\n")
            .map((e) => e.trim())
            .filter((e) => e),
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to save config");
      }

      const data = await response.json();
      setConfig(data.config);
      setSuccess("Configuration saved successfully!");

      // Clear success message after 3 seconds
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async () => {
    const newMode = !maintenanceMode;
    setMaintenanceMode(newMode);

    // Auto-save when toggling
    try {
      setSaving(true);
      const response = await fetch("/api/admin/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          maintenance_mode: newMode,
          maintenance_title: maintenanceTitle,
          maintenance_message: maintenanceMessage,
        }),
      });

      if (!response.ok) throw new Error("Failed to toggle maintenance mode");

      const data = await response.json();
      setConfig(data.config);
      setSuccess(newMode ? "Maintenance mode ENABLED" : "Maintenance mode DISABLED");
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setMaintenanceMode(!newMode); // Revert
      setError(err instanceof Error ? err.message : "Failed to toggle");
    } finally {
      setSaving(false);
    }
  };

  if (loading && !config) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin" />
          <span className="text-slate-500">Loading access control...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Section Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center">
          <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>
        <div>
          <h2 className="text-lg font-semibold text-[var(--foreground)]">
            Access Control
          </h2>
          <p className="text-sm text-slate-500">
            Block user access temporarily with a custom message
          </p>
        </div>
      </div>

      {/* Status Messages */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3">
          <svg className="w-5 h-5 text-red-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {success && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-3">
          <svg className="w-5 h-5 text-green-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-sm text-green-700">{success}</p>
        </div>
      )}

      {/* Main Control Card */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        {/* Toggle Section */}
        <div className={`p-6 ${maintenanceMode ? "bg-red-50" : "bg-slate-50"} border-b border-slate-200`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                maintenanceMode ? "bg-red-100" : "bg-slate-200"
              }`}>
                {maintenanceMode ? (
                  <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                  </svg>
                ) : (
                  <svg className="w-6 h-6 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                )}
              </div>
              <div>
                <h3 className="font-semibold text-lg text-slate-900">
                  {maintenanceMode ? "Maintenance Mode ACTIVE" : "Site is LIVE"}
                </h3>
                <p className="text-sm text-slate-500">
                  {maintenanceMode
                    ? "Non-admin users cannot access the app"
                    : "All users can access the app normally"}
                </p>
                {maintenanceMode && config?.maintenance_started_at && (
                  <p className="text-xs text-red-600 mt-1">
                    Started: {new Date(config.maintenance_started_at).toLocaleString()}
                  </p>
                )}
              </div>
            </div>

            {/* Toggle Button */}
            <button
              onClick={handleToggle}
              disabled={saving}
              className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 ${
                maintenanceMode
                  ? "bg-red-600 focus:ring-red-500"
                  : "bg-slate-300 focus:ring-slate-500"
              } ${saving ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              <span
                className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform shadow-md ${
                  maintenanceMode ? "translate-x-7" : "translate-x-1"
                }`}
              />
            </button>
          </div>
        </div>

        {/* Configuration Form */}
        <div className="p-6 space-y-6">
          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Maintenance Page Title
            </label>
            <input
              type="text"
              value={maintenanceTitle}
              onChange={(e) => setMaintenanceTitle(e.target.value)}
              placeholder="Under Maintenance"
              className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent transition"
            />
          </div>

          {/* Message */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Message to Users
            </label>
            <textarea
              value={maintenanceMessage}
              onChange={(e) => setMaintenanceMessage(e.target.value)}
              rows={4}
              placeholder="We are currently performing scheduled maintenance to improve your experience. Please check back shortly."
              className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent transition resize-none"
            />
            <p className="text-xs text-slate-400 mt-1">
              This message will be shown to users when maintenance mode is active
            </p>
          </div>

          {/* Allowed Emails */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Bypass Emails (Optional)
            </label>
            <textarea
              value={allowedEmails}
              onChange={(e) => setAllowedEmails(e.target.value)}
              rows={3}
              placeholder="user1@example.com&#10;user2@example.com"
              className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent transition resize-none font-mono text-sm"
            />
            <p className="text-xs text-slate-400 mt-1">
              One email per line. These users can access the app even during maintenance (in addition to admins)
            </p>
          </div>

          {/* Save Button */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
            <button
              onClick={fetchConfig}
              disabled={loading || saving}
              className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900 transition"
            >
              Reset
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-6 py-2.5 bg-[var(--primary)] text-white rounded-lg hover:bg-[var(--primary)]/90 transition disabled:opacity-50"
            >
              {saving ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Save Configuration
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Preview Card */}
      {maintenanceMode && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6">
          <h3 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
            Preview: What users will see
          </h3>
          <div className="bg-slate-50 rounded-xl p-8 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-amber-100 flex items-center justify-center">
              <svg className="w-8 h-8 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h4 className="text-xl font-bold text-slate-900 mb-2">
              {maintenanceTitle || "Under Maintenance"}
            </h4>
            <p className="text-slate-600 max-w-md mx-auto">
              {maintenanceMessage || "We are currently performing scheduled maintenance. Please check back shortly."}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
