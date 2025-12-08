"use client";

import { useEffect, useState, useCallback } from "react";
import type { TestAccount } from "@/app/api/admin/test-accounts/route";
import { TIER_LIMITS } from "@/lib/usage-limits/config";
import type { TierLimits } from "@/lib/usage-limits/types";

export default function TestAccountsManager() {
  const [accounts, setAccounts] = useState<TestAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Create form state
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [notes, setNotes] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [useCustomLimits, setUseCustomLimits] = useState(false);
  const [customLimits, setCustomLimits] = useState<Partial<TierLimits>>({
    aiGenerations: 10,
    aiRegenerations: 20,
    aiAssistantMessages: 50,
    placesAutocomplete: 200,
    placesSearch: 100,
    placesDetails: 60,
  });

  // Copied credential state
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const fetchAccounts = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/admin/test-accounts");
      if (!response.ok) throw new Error("Failed to fetch test accounts");
      const data = await response.json();
      setAccounts(data.accounts || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  const handleCreate = async () => {
    try {
      setCreating(true);
      setError(null);

      const payload: Record<string, unknown> = {
        notes: notes || undefined,
        expires_at: expiresAt || undefined,
        custom_limits: useCustomLimits ? customLimits : undefined,
      };

      const response = await fetch("/api/admin/test-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to create test account");
      }

      const data = await response.json();

      // Add new account to list
      setAccounts((prev) => [data.account, ...prev]);
      setSuccess(`Test account created: ${data.account.email}`);
      setTimeout(() => setSuccess(null), 5000);

      // Reset form
      setShowCreateForm(false);
      setNotes("");
      setExpiresAt("");
      setUseCustomLimits(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setCreating(false);
    }
  };

  const handleToggleActive = async (account: TestAccount) => {
    try {
      const response = await fetch("/api/admin/test-accounts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: account.id,
          is_active: !account.is_active,
        }),
      });

      if (!response.ok) throw new Error("Failed to update test account");

      const data = await response.json();
      setAccounts((prev) =>
        prev.map((a) => (a.id === account.id ? data.account : a))
      );

      setSuccess(
        `Account ${account.email} ${data.account.is_active ? "activated" : "deactivated"}`
      );
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  };

  const handleDelete = async (account: TestAccount) => {
    if (!confirm(`Delete test account ${account.email}? This cannot be undone.`)) {
      return;
    }

    try {
      const response = await fetch(
        `/api/admin/test-accounts?id=${account.id}`,
        { method: "DELETE" }
      );

      if (!response.ok) throw new Error("Failed to delete test account");

      setAccounts((prev) => prev.filter((a) => a.id !== account.id));
      setSuccess(`Account ${account.email} deleted`);
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  };

  const copyCredentials = (account: TestAccount) => {
    const text = `Email: ${account.email}\nPassword: ${account.temp_password}`;
    navigator.clipboard.writeText(text);
    setCopiedId(account.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const isExpired = (account: TestAccount) => {
    if (!account.expires_at) return false;
    return new Date(account.expires_at) < new Date();
  };

  if (loading && accounts.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin" />
          <span className="text-slate-500">Loading test accounts...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Section Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-cyan-100 flex items-center justify-center">
            <svg className="w-5 h-5 text-cyan-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
            </svg>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-[var(--foreground)]">
              Test Accounts
            </h2>
            <p className="text-sm text-slate-500">
              Create test accounts that bypass maintenance mode
            </p>
          </div>
        </div>

        <button
          onClick={() => setShowCreateForm(!showCreateForm)}
          className="flex items-center gap-2 px-4 py-2 bg-[var(--primary)] text-white rounded-lg hover:bg-[var(--primary)]/90 transition text-sm font-medium"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Test Account
        </button>
      </div>

      {/* Status Messages */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3">
          <svg className="w-5 h-5 text-red-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-sm text-red-700">{error}</p>
          <button onClick={() => setError(null)} className="ml-auto text-red-600 hover:text-red-800">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
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

      {/* Create Form */}
      {showCreateForm && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6">
          <h3 className="font-semibold text-slate-900 mb-4">Create Test Account</h3>
          <div className="space-y-4">
            {/* Notes */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Notes (Optional)
              </label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g., QA testing for v1.5 release"
                className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent transition"
              />
            </div>

            {/* Expiration */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Expires At (Optional)
              </label>
              <input
                type="datetime-local"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent transition"
              />
              <p className="text-xs text-slate-400 mt-1">
                Leave empty for no expiration
              </p>
            </div>

            {/* Custom Limits Toggle */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => setUseCustomLimits(!useCustomLimits)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  useCustomLimits ? "bg-[var(--primary)]" : "bg-slate-300"
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    useCustomLimits ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
              <span className="text-sm text-slate-700">Use custom limits</span>
            </div>

            {/* Custom Limits Form */}
            {useCustomLimits && (
              <div className="bg-slate-50 rounded-xl p-4 space-y-3">
                <p className="text-xs text-slate-500 mb-3">
                  Set -1 for unlimited. Default free tier limits shown below:
                </p>
                <div className="grid grid-cols-2 gap-3">
                  {(Object.keys(TIER_LIMITS.free) as (keyof TierLimits)[]).map((key) => (
                    <div key={key}>
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        {key.replace(/([A-Z])/g, " $1").trim()}
                      </label>
                      <input
                        type="number"
                        value={customLimits[key] ?? TIER_LIMITS.free[key]}
                        onChange={(e) =>
                          setCustomLimits((prev) => ({
                            ...prev,
                            [key]: parseInt(e.target.value) || 0,
                          }))
                        }
                        className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
              <button
                onClick={() => setShowCreateForm(false)}
                className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900 transition"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={creating}
                className="flex items-center gap-2 px-6 py-2.5 bg-[var(--primary)] text-white rounded-lg hover:bg-[var(--primary)]/90 transition disabled:opacity-50"
              >
                {creating ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Create Account
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Info Card */}
      <div className="bg-cyan-50 border border-cyan-200 rounded-xl p-4">
        <div className="flex gap-3">
          <svg className="w-5 h-5 text-cyan-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div className="text-sm text-cyan-800">
            <p className="font-medium mb-1">How Test Accounts Work:</p>
            <ul className="list-disc list-inside space-y-1 text-cyan-700">
              <li>Test accounts automatically bypass maintenance mode</li>
              <li>Credentials are auto-generated (email + password)</li>
              <li>Custom limits override default free tier restrictions</li>
              <li>Accounts can be deactivated or set to expire</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Accounts List */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex items-center justify-between">
          <h3 className="font-semibold text-slate-900">
            Active Test Accounts ({accounts.filter((a) => a.is_active && !isExpired(a)).length})
          </h3>
          <button
            onClick={fetchAccounts}
            disabled={loading}
            className="text-sm text-slate-500 hover:text-slate-700 transition"
          >
            <svg className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>

        {accounts.length === 0 ? (
          <div className="p-8 text-center text-slate-400">
            <svg className="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
            </svg>
            <p>No test accounts created yet</p>
            <p className="text-sm mt-1">Click &quot;New Test Account&quot; to create one</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {accounts.map((account) => {
              const expired = isExpired(account);
              const inactive = !account.is_active || expired;

              return (
                <div
                  key={account.id}
                  className={`p-4 ${inactive ? "bg-slate-50" : ""}`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      {/* Email & Status */}
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-mono text-sm text-slate-900 truncate">
                          {account.email}
                        </span>
                        {!account.is_active && (
                          <span className="px-2 py-0.5 text-xs font-medium bg-slate-200 text-slate-600 rounded-full">
                            Inactive
                          </span>
                        )}
                        {expired && (
                          <span className="px-2 py-0.5 text-xs font-medium bg-red-100 text-red-700 rounded-full">
                            Expired
                          </span>
                        )}
                        {account.custom_limits && (
                          <span className="px-2 py-0.5 text-xs font-medium bg-purple-100 text-purple-700 rounded-full">
                            Custom Limits
                          </span>
                        )}
                      </div>

                      {/* Meta info */}
                      <div className="flex items-center gap-4 text-xs text-slate-500">
                        <span>Created {new Date(account.created_at).toLocaleDateString()}</span>
                        <span>by {account.created_by}</span>
                        {account.expires_at && (
                          <span className={expired ? "text-red-500" : ""}>
                            Expires {new Date(account.expires_at).toLocaleDateString()}
                          </span>
                        )}
                      </div>

                      {/* Notes */}
                      {account.notes && (
                        <p className="text-sm text-slate-600 mt-1 truncate">
                          {account.notes}
                        </p>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2">
                      {/* Copy Credentials */}
                      <button
                        onClick={() => copyCredentials(account)}
                        className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition"
                        title="Copy credentials"
                      >
                        {copiedId === account.id ? (
                          <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        ) : (
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                          </svg>
                        )}
                      </button>

                      {/* Toggle Active */}
                      <button
                        onClick={() => handleToggleActive(account)}
                        className={`p-2 rounded-lg transition ${
                          account.is_active
                            ? "text-amber-500 hover:text-amber-600 hover:bg-amber-50"
                            : "text-green-500 hover:text-green-600 hover:bg-green-50"
                        }`}
                        title={account.is_active ? "Deactivate" : "Activate"}
                      >
                        {account.is_active ? (
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        ) : (
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        )}
                      </button>

                      {/* Delete */}
                      <button
                        onClick={() => handleDelete(account)}
                        className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
                        title="Delete account"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>

                  {/* Credentials (collapsed by default) */}
                  <details className="mt-3">
                    <summary className="text-xs text-slate-500 cursor-pointer hover:text-slate-700">
                      Show credentials
                    </summary>
                    <div className="mt-2 p-3 bg-slate-100 rounded-lg font-mono text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-slate-500">Email:</span>
                        <span className="text-slate-900">{account.email}</span>
                      </div>
                      <div className="flex items-center justify-between gap-2 mt-1">
                        <span className="text-slate-500">Password:</span>
                        <span className="text-slate-900">{account.temp_password}</span>
                      </div>
                    </div>
                  </details>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
