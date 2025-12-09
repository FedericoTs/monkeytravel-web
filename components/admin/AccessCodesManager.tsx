"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Key,
  Plus,
  Copy,
  Check,
  Trash2,
  Loader2,
  Users,
  Sparkles,
  RefreshCw,
  MessageCircle,
  Calendar,
  X,
  Edit2,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";

interface AccessCode {
  id: string;
  code: string;
  display_name: string | null;
  ai_generations_limit: number | null;
  ai_regenerations_limit: number | null;
  ai_assistant_limit: number | null;
  max_uses: number | null;
  current_uses: number;
  expires_at: string | null;
  is_active: boolean;
  created_at: string;
  notes: string | null;
  usage?: {
    generations: number;
    regenerations: number;
    assistant: number;
  };
}

interface NewCodeForm {
  code: string;
  display_name: string;
  ai_generations_limit: string;
  ai_regenerations_limit: string;
  ai_assistant_limit: string;
  max_uses: string;
  expires_at: string;
  notes: string;
}

const defaultForm: NewCodeForm = {
  code: "",
  display_name: "",
  ai_generations_limit: "",
  ai_regenerations_limit: "",
  ai_assistant_limit: "",
  max_uses: "",
  expires_at: "",
  notes: "",
};

export default function AccessCodesManager() {
  const [codes, setCodes] = useState<AccessCode[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [formData, setFormData] = useState<NewCodeForm>(defaultForm);
  const [isCreating, setIsCreating] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchCodes = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await fetch("/api/admin/access-codes");
      if (!response.ok) throw new Error("Failed to fetch access codes");
      const data = await response.json();
      setCodes(data.codes || []);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load codes");
    } finally {
      setIsLoading(false);
    }
  }, []);

  // No auto-fetch - only manual refresh

  const handleCreateCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsCreating(true);
    setError(null);

    try {
      const response = await fetch("/api/admin/access-codes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: formData.code || undefined,
          display_name: formData.display_name || undefined,
          ai_generations_limit: formData.ai_generations_limit ? parseInt(formData.ai_generations_limit) : null,
          ai_regenerations_limit: formData.ai_regenerations_limit ? parseInt(formData.ai_regenerations_limit) : null,
          ai_assistant_limit: formData.ai_assistant_limit ? parseInt(formData.ai_assistant_limit) : null,
          max_uses: formData.max_uses ? parseInt(formData.max_uses) : null,
          expires_at: formData.expires_at || null,
          notes: formData.notes || null,
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error);

      setCodes((prev) => [data.code, ...prev]);
      setShowCreateModal(false);
      setFormData(defaultForm);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create code");
    } finally {
      setIsCreating(false);
    }
  };

  const handleToggleActive = async (id: string, currentActive: boolean) => {
    try {
      const response = await fetch("/api/admin/access-codes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, is_active: !currentActive }),
      });

      if (!response.ok) throw new Error("Failed to update code");

      setCodes((prev) =>
        prev.map((code) =>
          code.id === id ? { ...code, is_active: !currentActive } : code
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update code");
    }
  };

  const handleDeleteCode = async (id: string) => {
    if (!confirm("Are you sure you want to delete this code? Users who redeemed it will lose access.")) {
      return;
    }

    try {
      const response = await fetch(`/api/admin/access-codes?id=${id}`, {
        method: "DELETE",
      });

      if (!response.ok) throw new Error("Failed to delete code");

      setCodes((prev) => prev.filter((code) => code.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete code");
    }
  };

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const formatLimit = (limit: number | null) => {
    return limit === null ? "∞" : limit.toString();
  };

  const formatDate = (date: string | null) => {
    if (!date) return "Never";
    return new Date(date).toLocaleDateString();
  };

  const EmptyState = () => (
    <div className="min-h-[400px] bg-white rounded-2xl border border-slate-200 flex items-center justify-center">
      <div className="text-center">
        <div className="w-16 h-16 rounded-full bg-cyan-100 flex items-center justify-center mx-auto mb-4">
          <Key className="w-8 h-8 text-cyan-600" />
        </div>
        <h3 className="text-lg font-semibold text-[var(--foreground)] mb-2">
          Access Codes
        </h3>
        <p className="text-slate-500 mb-6 max-w-xs">
          Click below to load existing codes or create a new one to invite early testers.
        </p>
        <div className="flex items-center gap-3 justify-center">
          <button
            onClick={fetchCodes}
            disabled={isLoading}
            className="px-6 py-3 bg-slate-100 text-slate-700 rounded-xl hover:bg-slate-200 transition font-medium disabled:opacity-50 flex items-center gap-2"
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            Load Codes
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-6 py-3 bg-cyan-600 text-white rounded-xl hover:bg-cyan-700 transition font-medium flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Create Code
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-[var(--foreground)]">
            Early Access Codes
          </h2>
          <p className="text-sm text-slate-500">
            Generate codes to give users access to AI features
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastUpdated && (
            <span className="text-xs text-slate-400">
              Updated {lastUpdated.toLocaleTimeString()}
            </span>
          )}
          {codes.length > 0 && (
            <>
              <button
                onClick={fetchCodes}
                disabled={isLoading}
                className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm text-slate-600 transition disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
                Refresh
              </button>
              <button
                onClick={() => setShowCreateModal(true)}
                className="flex items-center gap-2 px-4 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 transition font-medium"
              >
                <Plus className="w-4 h-4" />
                New Code
              </button>
            </>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">
            Dismiss
          </button>
        </div>
      )}

      {/* Content */}
      {codes.length === 0 && !isLoading ? (
        <EmptyState />
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          {isLoading && codes.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 text-cyan-600 animate-spin" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="text-left py-3 px-4 font-medium text-slate-600">Code</th>
                    <th className="text-left py-3 px-4 font-medium text-slate-600">Name</th>
                    <th className="text-center py-3 px-4 font-medium text-slate-600">Uses</th>
                    <th className="text-center py-3 px-4 font-medium text-slate-600">
                      <span className="flex items-center justify-center gap-1">
                        <Sparkles className="w-3.5 h-3.5" /> Gen
                      </span>
                    </th>
                    <th className="text-center py-3 px-4 font-medium text-slate-600">
                      <span className="flex items-center justify-center gap-1">
                        <RefreshCw className="w-3.5 h-3.5" /> Regen
                      </span>
                    </th>
                    <th className="text-center py-3 px-4 font-medium text-slate-600">
                      <span className="flex items-center justify-center gap-1">
                        <MessageCircle className="w-3.5 h-3.5" /> Chat
                      </span>
                    </th>
                    <th className="text-center py-3 px-4 font-medium text-slate-600">Expires</th>
                    <th className="text-center py-3 px-4 font-medium text-slate-600">Status</th>
                    <th className="text-right py-3 px-4 font-medium text-slate-600">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {codes.map((code) => (
                    <tr key={code.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <code className="font-mono bg-slate-100 px-2 py-1 rounded text-slate-800">
                            {code.code}
                          </code>
                          <button
                            onClick={() => copyCode(code.code)}
                            className="p-1 hover:bg-slate-200 rounded transition"
                            title="Copy code"
                          >
                            {copiedCode === code.code ? (
                              <Check className="w-3.5 h-3.5 text-green-600" />
                            ) : (
                              <Copy className="w-3.5 h-3.5 text-slate-400" />
                            )}
                          </button>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-slate-600">
                        {code.display_name || "-"}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span className="flex items-center justify-center gap-1">
                          <Users className="w-3.5 h-3.5 text-slate-400" />
                          {code.current_uses}/{formatLimit(code.max_uses)}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center text-slate-600">
                        <span title={`${code.usage?.generations || 0} used`}>
                          {formatLimit(code.ai_generations_limit)}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center text-slate-600">
                        <span title={`${code.usage?.regenerations || 0} used`}>
                          {formatLimit(code.ai_regenerations_limit)}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center text-slate-600">
                        <span title={`${code.usage?.assistant || 0} used`}>
                          {formatLimit(code.ai_assistant_limit)}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center text-slate-600">
                        <span className="flex items-center justify-center gap-1">
                          <Calendar className="w-3.5 h-3.5 text-slate-400" />
                          {formatDate(code.expires_at)}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <button
                          onClick={() => handleToggleActive(code.id, code.is_active)}
                          className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${
                            code.is_active
                              ? "bg-green-100 text-green-700"
                              : "bg-slate-100 text-slate-500"
                          }`}
                        >
                          {code.is_active ? (
                            <>
                              <ToggleRight className="w-3.5 h-3.5" /> Active
                            </>
                          ) : (
                            <>
                              <ToggleLeft className="w-3.5 h-3.5" /> Inactive
                            </>
                          )}
                        </button>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          onClick={() => handleDeleteCode(code.id)}
                          className="p-1.5 hover:bg-red-100 rounded transition text-slate-400 hover:text-red-600"
                          title="Delete code"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setShowCreateModal(false)}
          />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h3 className="text-lg font-semibold text-[var(--foreground)]">
                Create Access Code
              </h3>
              <button
                onClick={() => setShowCreateModal(false)}
                className="p-1 hover:bg-slate-100 rounded transition"
              >
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>

            <form onSubmit={handleCreateCode} className="p-6 space-y-4">
              {/* Code */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Code (optional - auto-generated if blank)
                </label>
                <input
                  type="text"
                  value={formData.code}
                  onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                  placeholder="e.g., BETA2024"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500 font-mono uppercase"
                  maxLength={20}
                />
              </div>

              {/* Display Name */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Display Name
                </label>
                <input
                  type="text"
                  value={formData.display_name}
                  onChange={(e) => setFormData({ ...formData, display_name: e.target.value })}
                  placeholder="e.g., Wave 1 Beta Testers"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500"
                />
              </div>

              {/* Limits */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Max Uses (blank = ∞)
                  </label>
                  <input
                    type="number"
                    value={formData.max_uses}
                    onChange={(e) => setFormData({ ...formData, max_uses: e.target.value })}
                    placeholder="50"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    min="1"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Expires
                  </label>
                  <input
                    type="date"
                    value={formData.expires_at}
                    onChange={(e) => setFormData({ ...formData, expires_at: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  />
                </div>
              </div>

              {/* AI Limits */}
              <div className="p-4 bg-slate-50 rounded-xl space-y-3">
                <h4 className="text-sm font-medium text-slate-700">
                  AI Limits Per User (blank = unlimited)
                </h4>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">
                      Generations
                    </label>
                    <input
                      type="number"
                      value={formData.ai_generations_limit}
                      onChange={(e) => setFormData({ ...formData, ai_generations_limit: e.target.value })}
                      placeholder="10"
                      className="w-full px-2 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500 text-sm"
                      min="1"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">
                      Regenerations
                    </label>
                    <input
                      type="number"
                      value={formData.ai_regenerations_limit}
                      onChange={(e) => setFormData({ ...formData, ai_regenerations_limit: e.target.value })}
                      placeholder="50"
                      className="w-full px-2 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500 text-sm"
                      min="1"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">
                      AI Chat
                    </label>
                    <input
                      type="number"
                      value={formData.ai_assistant_limit}
                      onChange={(e) => setFormData({ ...formData, ai_assistant_limit: e.target.value })}
                      placeholder="100"
                      className="w-full px-2 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500 text-sm"
                      min="1"
                    />
                  </div>
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Notes (internal)
                </label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  placeholder="e.g., For Twitter influencers..."
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  rows={2}
                />
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreating}
                  className="px-4 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 transition font-medium disabled:opacity-50 flex items-center gap-2"
                >
                  {isCreating ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    <>
                      <Plus className="w-4 h-4" />
                      Create Code
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
