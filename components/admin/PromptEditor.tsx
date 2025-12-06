"use client";

import { useEffect, useState, useCallback } from "react";
import type { AiPrompt } from "@/app/api/admin/ai-prompts/route";

export default function PromptEditor() {
  const [prompts, setPrompts] = useState<AiPrompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPrompt, setSelectedPrompt] = useState<AiPrompt | null>(null);
  const [editedText, setEditedText] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [tableExists, setTableExists] = useState(true);

  const fetchPrompts = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/admin/ai-prompts");
      if (!response.ok) {
        throw new Error("Failed to fetch prompts");
      }
      const data = await response.json();
      setPrompts(data.prompts || []);
      setTableExists(data.tableExists !== false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPrompts();
  }, [fetchPrompts]);

  const handleSelectPrompt = (prompt: AiPrompt) => {
    setSelectedPrompt(prompt);
    setEditedText(prompt.prompt_text);
    setSaveMessage(null);
  };

  const handleSave = async () => {
    if (!selectedPrompt) return;

    try {
      setSaving(true);
      setSaveMessage(null);

      const response = await fetch("/api/admin/ai-prompts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: selectedPrompt.id,
          prompt_text: editedText,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to save");
      }

      setSaveMessage({ type: "success", text: data.message });
      setSelectedPrompt(data.prompt);

      // Update the prompt in the list
      setPrompts(prev => prev.map(p =>
        p.id === data.prompt.id ? data.prompt : p
      ));
    } catch (err) {
      setSaveMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to save",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (prompt: AiPrompt) => {
    try {
      const response = await fetch("/api/admin/ai-prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: prompt.is_active ? "revert_to_default" : "activate",
          name: prompt.name,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to toggle");
      }

      // Refresh prompts
      fetchPrompts();
      setSaveMessage({ type: "success", text: data.message });
    } catch (err) {
      setSaveMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to toggle",
      });
    }
  };

  const estimateTokens = (text: string) => Math.ceil(text.length / 4);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-3 border-purple-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-slate-500">Loading prompts...</p>
        </div>
      </div>
    );
  }

  if (!tableExists) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-6">
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0">
            <svg className="w-6 h-6 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <div>
            <h3 className="font-semibold text-amber-900">Database Migration Required</h3>
            <p className="text-sm text-amber-800 mt-1">
              The <code className="bg-amber-100 px-1 rounded">ai_prompts</code> table doesn't exist yet.
              Run the migration to enable prompt editing:
            </p>
            <pre className="mt-3 p-3 bg-amber-100 rounded-lg text-xs overflow-x-auto">
              supabase/migrations/20241206_create_ai_prompts.sql
            </pre>
            <p className="text-sm text-amber-800 mt-3">
              Until then, prompts are using hardcoded defaults in <code className="bg-amber-100 px-1 rounded">lib/gemini.ts</code>
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
        <p className="text-red-600 font-medium">Error: {error}</p>
        <button
          onClick={fetchPrompts}
          className="mt-3 px-4 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">AI Prompt Editor</h2>
          <p className="text-sm text-slate-500">
            Customize Gemini prompts to fine-tune trip generation results
          </p>
        </div>
        <button
          onClick={fetchPrompts}
          className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm text-slate-600 transition"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Refresh
        </button>
      </div>

      {/* Save Message */}
      {saveMessage && (
        <div className={`p-4 rounded-lg ${
          saveMessage.type === "success"
            ? "bg-green-50 border border-green-200 text-green-800"
            : "bg-red-50 border border-red-200 text-red-800"
        }`}>
          {saveMessage.text}
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Prompt List */}
        <div className="lg:col-span-1 space-y-3">
          <h3 className="text-sm font-medium text-slate-500 uppercase tracking-wider">
            Available Prompts
          </h3>
          {prompts.length === 0 ? (
            <p className="text-slate-400 text-sm">No prompts found</p>
          ) : (
            <div className="space-y-2">
              {prompts.map((prompt) => (
                <button
                  key={prompt.id}
                  onClick={() => handleSelectPrompt(prompt)}
                  className={`w-full text-left p-4 rounded-xl border transition ${
                    selectedPrompt?.id === prompt.id
                      ? "border-purple-500 bg-purple-50"
                      : "border-slate-200 bg-white hover:border-purple-300"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium text-slate-900">{prompt.display_name}</span>
                    <span className={`px-2 py-0.5 rounded-full text-xs ${
                      prompt.is_active
                        ? "bg-green-100 text-green-700"
                        : "bg-slate-100 text-slate-600"
                    }`}>
                      {prompt.is_active ? "Active" : "Default"}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 line-clamp-2">
                    {prompt.description || "No description"}
                  </p>
                  <div className="flex items-center gap-3 mt-2 text-xs text-slate-400">
                    <span>v{prompt.version}</span>
                    <span>~{prompt.token_estimate || estimateTokens(prompt.prompt_text)} tokens</span>
                    <span className="capitalize">{prompt.category}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Editor */}
        <div className="lg:col-span-2">
          {selectedPrompt ? (
            <div className="bg-white rounded-xl border border-slate-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-semibold text-slate-900">{selectedPrompt.display_name}</h3>
                  <p className="text-sm text-slate-500">{selectedPrompt.description}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleToggleActive(selectedPrompt)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                      selectedPrompt.is_active
                        ? "bg-slate-100 text-slate-600 hover:bg-slate-200"
                        : "bg-green-100 text-green-700 hover:bg-green-200"
                    }`}
                  >
                    {selectedPrompt.is_active ? "Use Default" : "Activate"}
                  </button>
                </div>
              </div>

              {/* Prompt Text Editor */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Prompt Text
                </label>
                <textarea
                  value={editedText}
                  onChange={(e) => setEditedText(e.target.value)}
                  rows={20}
                  className="w-full px-4 py-3 border border-slate-200 rounded-lg font-mono text-sm resize-y focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  placeholder="Enter prompt text..."
                />
              </div>

              {/* Stats and Actions */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4 text-sm text-slate-500">
                  <span>~{estimateTokens(editedText)} tokens</span>
                  <span>{editedText.length} chars</span>
                  {editedText !== selectedPrompt.prompt_text && (
                    <span className="text-amber-600 font-medium">Unsaved changes</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setEditedText(selectedPrompt.prompt_text)}
                    disabled={editedText === selectedPrompt.prompt_text}
                    className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Reset
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={saving || editedText === selectedPrompt.prompt_text}
                    className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
                  >
                    {saving ? "Saving..." : "Save Changes"}
                  </button>
                </div>
              </div>

              {/* Version History Info */}
              <div className="mt-6 pt-4 border-t border-slate-100">
                <div className="flex items-center gap-4 text-xs text-slate-400">
                  <span>Version {selectedPrompt.version}</span>
                  <span>Last updated: {new Date(selectedPrompt.updated_at).toLocaleString()}</span>
                  {selectedPrompt.updated_by && (
                    <span>by {selectedPrompt.updated_by}</span>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-slate-50 rounded-xl border border-slate-200 p-12 text-center">
              <svg className="w-12 h-12 mx-auto text-slate-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="text-slate-500">Select a prompt to edit</p>
              <p className="text-sm text-slate-400 mt-1">
                Changes are applied immediately after saving
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Info Box */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-5">
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0">
            <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div className="text-sm text-blue-800">
            <p className="font-medium">How Prompt Editing Works</p>
            <ul className="mt-2 space-y-1 list-disc list-inside text-blue-700">
              <li><strong>Active</strong> prompts are used for trip generation</li>
              <li><strong>Default</strong> prompts fall back to hardcoded values in code</li>
              <li>Changes take effect immediately - no restart needed</li>
              <li>Each edit increments the version number for tracking</li>
              <li>Token estimates help manage API costs (~$0.001 per 1K tokens)</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
