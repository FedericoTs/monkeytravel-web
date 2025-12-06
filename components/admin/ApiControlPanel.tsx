"use client";

/**
 * API Control Panel
 *
 * Admin interface for managing external API access.
 * Provides simple toggles to enable/disable APIs and change block modes.
 */

import { useState, useEffect, useCallback } from "react";

interface ApiConfig {
  id: string;
  api_name: string;
  display_name: string;
  description: string | null;
  enabled: boolean;
  block_mode: "none" | "block_calls" | "block_keys" | "maintenance";
  category: string;
  cost_per_request: number;
}

const CATEGORY_LABELS: Record<string, string> = {
  google: "Google APIs",
  ai: "AI Services",
  images: "Image APIs",
  travel: "Travel APIs",
  other: "Other APIs",
};

const CATEGORY_COLORS: Record<string, string> = {
  google: "var(--primary)",
  ai: "var(--accent)",
  images: "var(--secondary)",
  travel: "#6366f1",
  other: "#78909c",
};

const BLOCK_MODE_OPTIONS = [
  { value: "none", label: "Active", color: "#22c55e" },
  { value: "block_calls", label: "Blocked", color: "#ef4444" },
  { value: "block_keys", label: "No Key", color: "#f59e0b" },
  { value: "maintenance", label: "Maintenance", color: "#8b5cf6" },
];

export default function ApiControlPanel() {
  const [configs, setConfigs] = useState<ApiConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const fetchConfigs = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/api-config");
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setConfigs(data.configs || []);
      setError(null);
    } catch (err) {
      setError("Failed to load API configurations");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConfigs();
  }, [fetchConfigs]);

  const showToast = (message: string, type: "success" | "error") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const updateConfig = async (
    apiName: string,
    updates: Partial<Pick<ApiConfig, "enabled" | "block_mode">>
  ) => {
    setUpdating(apiName);
    try {
      const res = await fetch("/api/admin/api-config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_name: apiName, ...updates }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to update");
      }

      // Use server-returned config to update state (not optimistic)
      // This ensures UI always reflects actual database state
      if (data.config) {
        setConfigs((prev) =>
          prev.map((c) =>
            c.api_name === apiName ? { ...c, ...data.config } : c
          )
        );
      } else {
        // Fallback: refetch all configs to ensure consistency
        await fetchConfigs();
      }

      showToast(data.message || "Updated successfully", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Update failed", "error");
      // On error, refetch to ensure UI matches server state
      await fetchConfigs();
    } finally {
      setUpdating(null);
    }
  };

  const toggleEnabled = (config: ApiConfig) => {
    const newEnabled = !config.enabled;
    updateConfig(config.api_name, {
      enabled: newEnabled,
      block_mode: newEnabled ? "none" : "block_calls",
    });
  };

  const changeBlockMode = (config: ApiConfig, mode: ApiConfig["block_mode"]) => {
    updateConfig(config.api_name, {
      enabled: mode !== "block_calls",
      block_mode: mode,
    });
  };

  const bulkAction = async (action: "enable_all" | "disable_all") => {
    setUpdating("bulk");
    try {
      const res = await fetch("/api/admin/api-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to update");
      }

      await fetchConfigs();
      showToast(data.message, "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Action failed", "error");
    } finally {
      setUpdating(null);
    }
  };

  // Group configs by category
  const groupedConfigs = configs.reduce((acc, config) => {
    const category = config.category || "other";
    if (!acc[category]) acc[category] = [];
    acc[category].push(config);
    return acc;
  }, {} as Record<string, ApiConfig[]>);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--primary)]" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 bg-red-50 border border-red-200 rounded-xl text-red-700">
        <p className="font-medium">Error loading API configurations</p>
        <p className="text-sm mt-1">{error}</p>
        <button
          onClick={fetchConfigs}
          className="mt-4 px-4 py-2 bg-red-100 hover:bg-red-200 rounded-lg text-sm"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg ${
            toast.type === "success"
              ? "bg-green-500 text-white"
              : "bg-red-500 text-white"
          }`}
        >
          {toast.message}
        </div>
      )}

      {/* Header with Bulk Actions */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-800">API Control</h2>
          <p className="text-sm text-gray-500 mt-1">
            Enable or disable external API access
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => bulkAction("enable_all")}
            disabled={updating === "bulk"}
            className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
          >
            Enable All
          </button>
          <button
            onClick={() => bulkAction("disable_all")}
            disabled={updating === "bulk"}
            className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
          >
            Disable All
          </button>
        </div>
      </div>

      {/* API Groups */}
      {Object.entries(groupedConfigs).map(([category, categoryConfigs]) => (
        <div
          key={category}
          className="bg-white rounded-xl border border-gray-200 overflow-hidden"
        >
          {/* Category Header */}
          <div
            className="px-4 py-3 border-b border-gray-100"
            style={{ backgroundColor: `${CATEGORY_COLORS[category]}10` }}
          >
            <h3
              className="font-semibold text-sm"
              style={{ color: CATEGORY_COLORS[category] }}
            >
              {CATEGORY_LABELS[category] || category}
            </h3>
          </div>

          {/* API Items */}
          <div className="divide-y divide-gray-100">
            {categoryConfigs.map((config) => (
              <div
                key={config.api_name}
                className="px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors"
              >
                {/* Left: Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-800">
                      {config.display_name}
                    </span>
                    {config.cost_per_request > 0 && (
                      <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded">
                        ${config.cost_per_request.toFixed(4)}/req
                      </span>
                    )}
                    {config.cost_per_request === 0 && (
                      <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded">
                        Free
                      </span>
                    )}
                  </div>
                  {config.description && (
                    <p className="text-xs text-gray-500 mt-0.5 truncate">
                      {config.description}
                    </p>
                  )}
                </div>

                {/* Right: Controls */}
                <div className="flex items-center gap-3 ml-4">
                  {/* Block Mode Selector */}
                  <select
                    value={config.enabled ? config.block_mode : "block_calls"}
                    onChange={(e) =>
                      changeBlockMode(
                        config,
                        e.target.value as ApiConfig["block_mode"]
                      )
                    }
                    disabled={updating === config.api_name}
                    className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--primary)] disabled:opacity-50"
                    style={{
                      backgroundColor:
                        BLOCK_MODE_OPTIONS.find(
                          (o) =>
                            o.value ===
                            (config.enabled ? config.block_mode : "block_calls")
                        )?.color + "15",
                    }}
                  >
                    {BLOCK_MODE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>

                  {/* Toggle Switch */}
                  <button
                    onClick={() => toggleEnabled(config)}
                    disabled={updating === config.api_name}
                    className={`relative w-12 h-6 rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[var(--primary)] ${
                      config.enabled ? "bg-green-500" : "bg-gray-300"
                    } ${updating === config.api_name ? "opacity-50" : ""}`}
                  >
                    <span
                      className={`absolute left-1 top-1 w-4 h-4 bg-white rounded-full shadow transition-transform duration-200 ${
                        config.enabled ? "translate-x-6" : ""
                      }`}
                    />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Legend */}
      <div className="bg-gray-50 rounded-lg p-4">
        <p className="text-xs font-medium text-gray-500 mb-2">Block Modes:</p>
        <div className="flex flex-wrap gap-3">
          {BLOCK_MODE_OPTIONS.map((option) => (
            <div key={option.value} className="flex items-center gap-1.5">
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: option.color }}
              />
              <span className="text-xs text-gray-600">
                <strong>{option.label}</strong>
                {option.value === "none" && " - API works normally"}
                {option.value === "block_calls" && " - Returns error immediately"}
                {option.value === "block_keys" && " - Calls API without key (testing)"}
                {option.value === "maintenance" && " - Shows maintenance message"}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
