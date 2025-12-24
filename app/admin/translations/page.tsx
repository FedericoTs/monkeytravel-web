"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

type Language = "en" | "es" | "it";
type TranslationData = Record<string, unknown>;

const LANGUAGES: { code: Language; name: string; flag: string }[] = [
  { code: "en", name: "English", flag: "🇬🇧" },
  { code: "es", name: "Español", flag: "🇪🇸" },
  { code: "it", name: "Italiano", flag: "🇮🇹" },
];

export default function TranslationsPage() {
  const [selectedLang, setSelectedLang] = useState<Language>("en");
  const [translations, setTranslations] = useState<Record<Language, TranslationData>>({
    en: {},
    es: {},
    it: {},
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [loading, setLoading] = useState(true);

  // Load translations
  useEffect(() => {
    async function loadTranslations() {
      setLoading(true);
      try {
        const response = await fetch("/api/admin/translations");
        if (response.ok) {
          const data = await response.json();
          setTranslations(data.translations);
        }
      } catch (error) {
        console.error("Failed to load translations:", error);
        setMessage({ type: "error", text: "Failed to load translations" });
      } finally {
        setLoading(false);
      }
    }
    loadTranslations();
  }, []);

  // Flatten nested object for display
  function flattenObject(obj: unknown, prefix = ""): Record<string, string> {
    const result: Record<string, string> = {};

    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      for (const [key, value] of Object.entries(obj)) {
        const newKey = prefix ? `${prefix}.${key}` : key;
        if (typeof value === "object" && value !== null && !Array.isArray(value)) {
          Object.assign(result, flattenObject(value, newKey));
        } else {
          result[newKey] = String(value);
        }
      }
    }
    return result;
  }

  // Get nested value from object
  function getNestedValue(obj: unknown, path: string): unknown {
    const keys = path.split(".");
    let current: unknown = obj;
    for (const key of keys) {
      if (current && typeof current === "object" && key in current) {
        current = (current as Record<string, unknown>)[key];
      } else {
        return undefined;
      }
    }
    return current;
  }

  // Set nested value in object
  function setNestedValue(obj: TranslationData, path: string, value: string): TranslationData {
    const keys = path.split(".");
    const result = JSON.parse(JSON.stringify(obj));
    let current = result;

    for (let i = 0; i < keys.length - 1; i++) {
      if (!(keys[i] in current)) {
        current[keys[i]] = {};
      }
      current = current[keys[i]];
    }
    current[keys[keys.length - 1]] = value;
    return result;
  }

  const flattenedTranslations = flattenObject(translations[selectedLang]);
  const filteredKeys = Object.keys(flattenedTranslations).filter(
    (key) =>
      key.toLowerCase().includes(searchQuery.toLowerCase()) ||
      flattenedTranslations[key].toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Group keys by top-level section
  const groupedKeys: Record<string, string[]> = {};
  for (const key of filteredKeys) {
    const section = key.split(".")[0];
    if (!groupedKeys[section]) {
      groupedKeys[section] = [];
    }
    groupedKeys[section].push(key);
  }

  async function handleSave(key: string, value: string) {
    setSaving(true);
    setMessage(null);

    try {
      const response = await fetch("/api/admin/translations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          language: selectedLang,
          key,
          value,
        }),
      });

      if (response.ok) {
        setTranslations((prev) => ({
          ...prev,
          [selectedLang]: setNestedValue(prev[selectedLang], key, value),
        }));
        setEditingKey(null);
        setMessage({ type: "success", text: `Updated "${key}"` });
        setTimeout(() => setMessage(null), 3000);
      } else {
        const error = await response.json();
        setMessage({ type: "error", text: error.error || "Failed to save" });
      }
    } catch {
      setMessage({ type: "error", text: "Failed to save translation" });
    } finally {
      setSaving(false);
    }
  }

  function toggleSection(section: string) {
    const newExpanded = new Set(expandedKeys);
    if (newExpanded.has(section)) {
      newExpanded.delete(section);
    } else {
      newExpanded.add(section);
    }
    setExpandedKeys(newExpanded);
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-slate-600">Loading translations...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <Link href="/admin" className="flex items-center gap-2">
                <img src="/images/logo.png" alt="MonkeyTravel" className="h-8 w-8" />
                <span className="font-semibold text-lg text-slate-900">MonkeyTravel</span>
              </Link>
              <span className="text-slate-300">|</span>
              <span className="text-[var(--primary)] font-medium">Translations</span>
            </div>
            <Link href="/admin" className="text-sm text-[var(--primary)] hover:underline">
              Back to Admin
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Message */}
        {message && (
          <div
            className={`mb-4 p-3 rounded-lg ${
              message.type === "success" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
            }`}
          >
            {message.text}
          </div>
        )}

        {/* Controls */}
        <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
          <div className="flex flex-col sm:flex-row gap-4">
            {/* Language selector */}
            <div className="flex gap-2">
              {LANGUAGES.map((lang) => (
                <button
                  key={lang.code}
                  onClick={() => setSelectedLang(lang.code)}
                  className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                    selectedLang === lang.code
                      ? "bg-[var(--primary)] text-white"
                      : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                  }`}
                >
                  {lang.flag} {lang.name}
                </button>
              ))}
            </div>

            {/* Search */}
            <div className="flex-1">
              <input
                type="text"
                placeholder="Search keys or values..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/50"
              />
            </div>
          </div>

          <div className="mt-4 text-sm text-slate-600">
            {filteredKeys.length} translations found in {Object.keys(groupedKeys).length} sections
          </div>
        </div>

        {/* Translation sections */}
        <div className="space-y-4">
          {Object.entries(groupedKeys)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([section, keys]) => (
              <div key={section} className="bg-white rounded-xl shadow-sm overflow-hidden">
                {/* Section header */}
                <button
                  onClick={() => toggleSection(section)}
                  className="w-full px-6 py-4 flex items-center justify-between bg-slate-50 hover:bg-slate-100 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-semibold text-slate-900">{section}</span>
                    <span className="text-sm text-slate-500">{keys.length} keys</span>
                  </div>
                  <svg
                    className={`w-5 h-5 text-slate-400 transition-transform ${
                      expandedKeys.has(section) ? "rotate-180" : ""
                    }`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {/* Section content */}
                {expandedKeys.has(section) && (
                  <div className="divide-y divide-slate-100">
                    {keys.sort().map((key) => {
                      const value = flattenedTranslations[key];
                      const enValue = getNestedValue(translations.en, key);
                      const isEditing = editingKey === key;
                      const shortKey = key.replace(`${section}.`, "");

                      return (
                        <div key={key} className="px-6 py-4 hover:bg-slate-50">
                          <div className="flex items-start gap-4">
                            {/* Key */}
                            <div className="w-1/3 min-w-0">
                              <code className="text-sm text-slate-600 break-all">{shortKey}</code>
                              {selectedLang !== "en" && enValue && (
                                <div className="mt-1 text-xs text-slate-400 italic">
                                  EN: {String(enValue)}
                                </div>
                              )}
                            </div>

                            {/* Value */}
                            <div className="flex-1">
                              {isEditing ? (
                                <div className="flex gap-2">
                                  <textarea
                                    value={editValue}
                                    onChange={(e) => setEditValue(e.target.value)}
                                    className="flex-1 px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/50 text-sm"
                                    rows={Math.min(5, Math.max(2, editValue.split("\n").length))}
                                    autoFocus
                                  />
                                  <div className="flex flex-col gap-1">
                                    <button
                                      onClick={() => handleSave(key, editValue)}
                                      disabled={saving}
                                      className="px-3 py-1.5 bg-[var(--primary)] text-white rounded-lg text-sm hover:opacity-90 disabled:opacity-50"
                                    >
                                      {saving ? "..." : "Save"}
                                    </button>
                                    <button
                                      onClick={() => setEditingKey(null)}
                                      className="px-3 py-1.5 bg-slate-200 text-slate-700 rounded-lg text-sm hover:bg-slate-300"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <div
                                  onClick={() => {
                                    setEditingKey(key);
                                    setEditValue(value);
                                  }}
                                  className="cursor-pointer text-sm text-slate-800 hover:bg-slate-100 px-3 py-2 rounded-lg -mx-3 -my-2"
                                >
                                  {value || <span className="text-red-400 italic">Missing translation</span>}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
        </div>

        {filteredKeys.length === 0 && (
          <div className="text-center py-12 text-slate-500">
            No translations found matching your search.
          </div>
        )}
      </main>
    </div>
  );
}
