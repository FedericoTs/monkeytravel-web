"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { ChecklistItem, ChecklistCategory } from "@/types/timeline";

interface PreTripChecklistProps {
  items: ChecklistItem[];
  onToggle: (id: string) => void;
  onAdd: (text: string, category: ChecklistCategory) => void;
  onDelete: (id: string) => void;
  isLoading?: boolean;
}

export default function PreTripChecklist({
  items,
  onToggle,
  onAdd,
  onDelete,
  isLoading = false,
}: PreTripChecklistProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [newItemText, setNewItemText] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);

  const completedCount = items.filter((i) => i.is_checked).length;
  const progress = items.length > 0 ? (completedCount / items.length) * 100 : 0;

  const groupedItems = items.reduce((acc, item) => {
    if (!acc[item.category]) acc[item.category] = [];
    acc[item.category].push(item);
    return acc;
  }, {} as Record<string, ChecklistItem[]>);

  const categoryConfig: Record<ChecklistCategory, { label: string; icon: string }> = {
    booking: { label: "Bookings", icon: "🎫" },
    packing: { label: "Packing", icon: "🧳" },
    document: { label: "Documents", icon: "📄" },
    custom: { label: "Other", icon: "📝" },
  };

  const handleAddItem = () => {
    if (newItemText.trim()) {
      onAdd(newItemText.trim(), "custom");
      setNewItemText("");
      setShowAddForm(false);
    }
  };

  if (isLoading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-slate-100 animate-pulse" />
          <div className="flex-1">
            <div className="h-4 bg-slate-100 rounded w-1/3 mb-2 animate-pulse" />
            <div className="h-3 bg-slate-100 rounded w-1/4 animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-4 py-4 hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="relative w-10 h-10">
            {/* Circular progress */}
            <svg className="w-10 h-10 transform -rotate-90">
              <circle
                cx="20"
                cy="20"
                r="16"
                fill="none"
                stroke="#E2E8F0"
                strokeWidth="3"
              />
              <motion.circle
                cx="20"
                cy="20"
                r="16"
                fill="none"
                stroke="var(--primary)"
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={100}
                strokeDashoffset={100 - progress}
                initial={{ strokeDashoffset: 100 }}
                animate={{ strokeDashoffset: 100 - progress }}
                transition={{ duration: 0.5, ease: "easeOut" }}
              />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-slate-700">
              {Math.round(progress)}%
            </span>
          </div>
          <div className="text-left">
            <h3 className="font-semibold text-slate-900">Trip Preparation</h3>
            <p className="text-sm text-slate-500">
              {completedCount} of {items.length} completed
            </p>
          </div>
        </div>
        <motion.svg
          animate={{ rotate: isExpanded ? 180 : 0 }}
          className="w-5 h-5 text-slate-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </motion.svg>
      </button>

      {/* Content */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="px-4 pb-4 space-y-4">
              {items.length === 0 ? (
                <p className="text-center text-slate-400 py-4">
                  No checklist items yet. Add your first item below!
                </p>
              ) : (
                Object.entries(categoryConfig).map(([category, config]) => {
                  const categoryItems = groupedItems[category] || [];
                  if (categoryItems.length === 0 && category !== "custom") return null;

                  return (
                    <div key={category}>
                      <h4 className="flex items-center gap-2 text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
                        <span>{config.icon}</span>
                        {config.label}
                      </h4>
                      <div className="space-y-1">
                        {categoryItems.map((item) => (
                          <ChecklistRow
                            key={item.id}
                            item={item}
                            onToggle={() => onToggle(item.id)}
                            onDelete={() => onDelete(item.id)}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })
              )}

              {/* Add Item */}
              {showAddForm ? (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={newItemText}
                    onChange={(e) => setNewItemText(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleAddItem()}
                    placeholder="Add a custom item..."
                    className="
                      flex-1 px-3 py-2 rounded-lg
                      border border-slate-200
                      focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20
                      outline-none text-sm
                    "
                    autoFocus
                  />
                  <button
                    onClick={handleAddItem}
                    className="
                      px-3 py-2 rounded-lg
                      bg-[var(--primary)] text-white
                      text-sm font-medium
                      hover:bg-[var(--primary)]/90
                    "
                  >
                    Add
                  </button>
                  <button
                    onClick={() => {
                      setShowAddForm(false);
                      setNewItemText("");
                    }}
                    className="px-3 py-2 text-sm text-slate-500 hover:text-slate-700"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowAddForm(true)}
                  className="
                    flex items-center gap-2
                    text-sm text-[var(--primary)] font-medium
                    hover:underline
                  "
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Add custom item
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ChecklistRow({
  item,
  onToggle,
  onDelete,
}: {
  item: ChecklistItem;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const [showDelete, setShowDelete] = useState(false);

  const isDueSoon = item.due_date && !item.is_checked && (() => {
    const due = new Date(item.due_date);
    const now = new Date();
    const diff = due.getTime() - now.getTime();
    return diff < 3 * 24 * 60 * 60 * 1000; // 3 days
  })();

  return (
    <div
      className="
        flex items-center gap-3 px-3 py-2.5 rounded-lg
        hover:bg-slate-50 group
        transition-colors
      "
      onMouseEnter={() => setShowDelete(true)}
      onMouseLeave={() => setShowDelete(false)}
    >
      <button
        onClick={onToggle}
        className={`
          flex-shrink-0 w-5 h-5 rounded-md border-2
          flex items-center justify-center
          transition-all duration-200
          ${item.is_checked
            ? "bg-[var(--primary)] border-[var(--primary)]"
            : "border-slate-300 hover:border-[var(--primary)]"
          }
        `}
      >
        {item.is_checked && (
          <motion.svg
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="w-3 h-3 text-white"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </motion.svg>
        )}
      </button>

      <span className={`
        flex-1 text-sm
        ${item.is_checked ? "text-slate-400 line-through" : "text-slate-700"}
      `}>
        {item.text}
      </span>

      {isDueSoon && (
        <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-xs font-medium">
          Due soon
        </span>
      )}

      {item.is_checked && (
        <span className="text-xs text-green-600 font-medium">Done</span>
      )}

      {showDelete && (
        <button
          onClick={onDelete}
          className="
            p-1 rounded text-slate-400 hover:text-red-500
            opacity-0 group-hover:opacity-100 transition-opacity
          "
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}
