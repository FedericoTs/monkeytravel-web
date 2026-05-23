"use client";

/**
 * Navbar bell icon — unread count badge + dropdown of the latest items.
 *
 * Two data sources:
 *   1. Initial fetch from /api/notifications (returns recent rows + count).
 *   2. Realtime subscription to public.notifications via Supabase — we get
 *      pushed inserts so the badge updates without polling. Migration
 *      20260523_notifications_scaffold.sql enables this on supabase_realtime.
 *
 * Anonymous users see no bell at all (returns null) — the API already
 * handles them by returning an empty list, but rendering an empty bell on
 * marketing pages is visually noisy. Mounts after first hydration so
 * SSR-emitted HTML stays clean.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { Link } from "@/lib/i18n/routing";
import type { NotificationRow } from "@/lib/notifications/types";

interface NotificationsAPI {
  notifications: NotificationRow[];
  unreadCount: number;
}

export default function NotificationBell() {
  const [authedUserId, setAuthedUserId] = useState<string | null>(null);
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // ----- 1. Auth state — only mount the real bell for signed-in users -----
  useEffect(() => {
    const supabase = createClient();
    let mounted = true;

    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!mounted) return;
      setAuthedUserId(user?.id ?? null);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (!mounted) return;
        setAuthedUserId(session?.user?.id ?? null);
      }
    );

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  // ----- 2. Initial fetch + refresh helper -----
  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications?includeRead=1&limit=20", {
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) return;
      const json = (await res.json()) as { data: NotificationsAPI } | NotificationsAPI;
      // apiSuccess wraps under .data on some routes — handle both.
      const payload: NotificationsAPI =
        "data" in json && (json as { data?: unknown }).data
          ? (json as { data: NotificationsAPI }).data
          : (json as NotificationsAPI);
      setItems(payload.notifications ?? []);
      setUnread(payload.unreadCount ?? 0);
    } catch {
      // Best-effort — the bell shouldn't surface fetch errors to the user.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authedUserId) {
      setItems([]);
      setUnread(0);
      setLoading(false);
      return;
    }
    refresh();
  }, [authedUserId, refresh]);

  // ----- 3. Realtime subscription -----
  // We listen for INSERTs scoped to this user. Migration enabled the table
  // on supabase_realtime; RLS still applies so even without the user_id
  // filter the user couldn't see others' rows — the filter is a network
  // optimization, not a security boundary.
  useEffect(() => {
    if (!authedUserId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`notifications:${authedUserId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${authedUserId}`,
        },
        () => {
          // We could append the new row directly from `payload.new`, but
          // a refetch keeps unread counts + ordering consistent and is
          // cheap (single short query).
          refresh();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [authedUserId, refresh]);

  // ----- 4. Click-outside closes dropdown -----
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!dropdownRef.current) return;
      if (!dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const markAllRead = async () => {
    setUnread(0);
    setItems((prev) =>
      prev.map((n) => (n.read_at ? n : { ...n, read_at: new Date().toISOString() }))
    );
    try {
      await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action: "mark_all_read" }),
      });
    } catch {
      // Optimistic; refresh to re-sync if the server fell out of agreement.
      refresh();
    }
  };

  const markOneRead = async (id: string) => {
    setItems((prev) =>
      prev.map((n) =>
        n.id === id && !n.read_at ? { ...n, read_at: new Date().toISOString() } : n
      )
    );
    setUnread((c) => Math.max(0, c - 1));
    try {
      await fetch(`/api/notifications/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action: "mark_read" }),
      });
    } catch {
      refresh();
    }
  };

  // Hide entirely for anonymous visitors — no auth = no bell on marketing
  // pages. (The bell is only useful in-app.)
  if (!authedUserId) return null;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="relative p-2 rounded-full text-[var(--foreground-muted)] hover:text-[var(--primary)] hover:bg-[var(--primary)]/5 transition-colors"
        aria-label={unread > 0 ? `${unread} unread notifications` : "Notifications"}
        aria-haspopup="true"
        aria-expanded={open}
      >
        <svg
          className="w-5 h-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
          />
        </svg>
        {unread > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center"
            aria-hidden
          >
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 sm:w-96 max-h-[80vh] bg-white rounded-xl shadow-lg border border-slate-200 overflow-hidden z-50">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <h3 className="font-semibold text-slate-900">Notifications</h3>
            {unread > 0 && (
              <button
                onClick={markAllRead}
                className="text-xs font-medium text-[var(--primary)] hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="overflow-y-auto max-h-[60vh]">
            {loading ? (
              <div className="px-4 py-8 text-center text-sm text-slate-400">
                Loading…
              </div>
            ) : items.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <p className="text-sm text-slate-600">You're all caught up.</p>
                <p className="text-xs text-slate-400 mt-1">
                  You'll see updates here when collaborators vote, comment, or accept invites.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {items.map((n) => (
                  <NotificationItem
                    key={n.id}
                    notification={n}
                    onClick={() => markOneRead(n.id)}
                  />
                ))}
              </ul>
            )}
          </div>

          <div className="px-4 py-2.5 border-t border-slate-100 bg-slate-50/50">
            <Link
              href="/profile/notifications"
              className="block text-center text-xs font-medium text-[var(--primary)] hover:underline"
              onClick={() => setOpen(false)}
            >
              View all settings
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

function NotificationItem({
  notification,
  onClick,
}: {
  notification: NotificationRow;
  onClick: () => void;
}) {
  const unread = !notification.read_at;
  const message = (notification.payload?.message as string) ?? "Update";
  const href = (notification.payload?.href as string | undefined) ?? null;
  const created = new Date(notification.created_at);
  const timeAgo = formatTimeAgo(created);

  const inner = (
    <div
      className={`px-4 py-3 hover:bg-slate-50 transition-colors cursor-pointer ${
        unread ? "bg-blue-50/40" : ""
      }`}
      onClick={onClick}
    >
      <div className="flex items-start gap-2">
        {unread && (
          <span className="mt-1.5 w-2 h-2 rounded-full bg-[var(--primary)] shrink-0" />
        )}
        <div className={`flex-1 min-w-0 ${unread ? "" : "pl-4"}`}>
          <p className={`text-sm ${unread ? "font-medium text-slate-900" : "text-slate-700"}`}>
            {message}
          </p>
          <p className="text-xs text-slate-400 mt-0.5">{timeAgo}</p>
        </div>
      </div>
    </div>
  );

  return (
    <li>
      {href ? <Link href={href as never}>{inner}</Link> : inner}
    </li>
  );
}

function formatTimeAgo(d: Date): string {
  const diff = Date.now() - d.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return d.toLocaleDateString();
}
