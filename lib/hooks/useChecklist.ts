"use client";

import { useState, useCallback, useEffect } from "react";
import type { ChecklistItem, ChecklistCategory } from "@/types/timeline";

interface UseChecklistReturn {
  items: ChecklistItem[];
  isLoading: boolean;
  error: string | null;
  toggleItem: (id: string) => Promise<void>;
  addItem: (text: string, category: ChecklistCategory) => Promise<void>;
  deleteItem: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useChecklist(tripId: string): UseChecklistReturn {
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchItems = useCallback(async () => {
    try {
      setError(null);
      const response = await fetch(`/api/trips/${tripId}/checklist`);

      if (!response.ok) {
        throw new Error("Failed to fetch checklist");
      }

      const data = await response.json();
      setItems(data.items || []);
    } catch (err) {
      console.error("Error fetching checklist:", err);
      setError(err instanceof Error ? err.message : "Failed to load checklist");
    } finally {
      setIsLoading(false);
    }
  }, [tripId]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const toggleItem = useCallback(async (id: string) => {
    // Optimistic update
    const originalItems = [...items];
    setItems((prev) =>
      prev.map((item) =>
        item.id === id
          ? { ...item, is_checked: !item.is_checked, checked_at: !item.is_checked ? new Date().toISOString() : undefined }
          : item
      )
    );

    try {
      const item = items.find((i) => i.id === id);
      const response = await fetch(`/api/trips/${tripId}/checklist/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_checked: !item?.is_checked }),
      });

      if (!response.ok) {
        throw new Error("Failed to update item");
      }
    } catch (err) {
      console.error("Error toggling item:", err);
      // Revert on error
      setItems(originalItems);
      setError("Failed to update item");
    }
  }, [items, tripId]);

  const addItem = useCallback(async (text: string, category: ChecklistCategory) => {
    try {
      const response = await fetch(`/api/trips/${tripId}/checklist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, category }),
      });

      if (!response.ok) {
        throw new Error("Failed to add item");
      }

      const data = await response.json();
      setItems((prev) => [...prev, data.item]);
    } catch (err) {
      console.error("Error adding item:", err);
      setError("Failed to add item");
      throw err;
    }
  }, [tripId]);

  const deleteItem = useCallback(async (id: string) => {
    // Optimistic update
    const originalItems = [...items];
    setItems((prev) => prev.filter((item) => item.id !== id));

    try {
      const response = await fetch(`/api/trips/${tripId}/checklist/${id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to delete item");
      }
    } catch (err) {
      console.error("Error deleting item:", err);
      // Revert on error
      setItems(originalItems);
      setError("Failed to delete item");
    }
  }, [items, tripId]);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    await fetchItems();
  }, [fetchItems]);

  return {
    items,
    isLoading,
    error,
    toggleItem,
    addItem,
    deleteItem,
    refresh,
  };
}
