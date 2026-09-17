"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import { BellIcon } from "@hugeicons/core-free-icons";
import { cn } from "@ep/ui/lib/utils";
import { MobileDrawer } from "@ep/ui/components/mobile-drawer";
import { useIsMobile } from "@ep/ui/hooks/use-is-mobile";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuSeparator,
} from "@ep/ui/components/dropdown-menu";
import { apiRequest, getToken } from "../../lib/api";
import { formatWhen } from "../../lib/referral";
import type { NotificationItem } from "../../lib/brand";

const auth = () => ({ token: getToken() || undefined });

export function NotificationsMenu() {
  const router = useRouter();
  const isMobile = useIsMobile();

  const [open, setOpen] = React.useState(false);
  const [listOpen, setListOpen] = React.useState(false);
  const [unread, setUnread] = React.useState(0);
  const [items, setItems] = React.useState<NotificationItem[]>([]);
  const [loading, setLoading] = React.useState(false);

  const load = React.useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [{ count }, list] = await Promise.all([
        apiRequest<{ count: number }>("/notifications/unread-count", auth()),
        apiRequest<NotificationItem[]>("/notifications", auth()),
      ]);
      setUnread(count);
      setItems(list);
    } catch {
      // badges are non-critical; keep the old state on failure
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load(true);
    const onVisible = () => {
      if (document.visibilityState === "visible") load(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  const markAll = async () => {
    try {
      await apiRequest("/notifications/read-all", { method: "PATCH", ...auth() });
      setItems((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnread(0);
    } catch {
      // ignore
    }
  };

  const openItem = async (n: NotificationItem) => {
    if (!n.read) {
      try {
        await apiRequest(`/notifications/${n.id}/read`, { method: "PATCH", ...auth() });
        setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
        setUnread((v) => Math.max(v - 1, 0));
      } catch {
        // ignore
      }
    }
    setListOpen(false);
    setOpen(false);
    if (n.campaignId) router.push(`/dashboard/brand/campaign/${n.campaignId}`);
  };

  const bell = (
    <button
      onClick={() => (isMobile ? setListOpen(true) : setOpen(true))}
      aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ""}`}
      className="relative flex h-9 w-9 items-center justify-center rounded-full bg-white border border-stone-200"
    >
      <HugeiconsIcon icon={BellIcon} size={16} className="text-stone-600" />
      {unread > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-semibold text-white">
          {unread > 9 ? "9+" : unread}
        </span>
      )}
    </button>
  );

  const list = (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between px-1">
        <span className="text-sm font-semibold text-stone-900">Notifications</span>
        {items.some((n) => !n.read) && (
          <button
            onClick={markAll}
            className="text-xs font-semibold text-stone-900 underline underline-offset-2"
          >
            Mark all read
          </button>
        )}
      </div>
      <DropdownMenuSeparator />
      {loading && items.length === 0 ? (
        <p className="px-1 py-4 text-center text-xs font-medium text-stone-500">Loading…</p>
      ) : items.length === 0 ? (
        <p className="px-1 py-6 text-center text-xs font-medium text-stone-500">You&apos;re all caught up.</p>
      ) : (
        <ul className="flex flex-col">
          {items.slice(0, 12).map((n) => (
            <li key={n.id}>
              <button
                onClick={() => openItem(n)}
                className={cn(
                  "flex w-full flex-col items-start gap-0.5 rounded-xl px-3 py-2.5 text-left",
                  n.read ? "opacity-60" : "bg-stone-50"
                )}
              >
                <span className="flex w-full items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-stone-900">{n.title}</span>
                  <span className="shrink-0 text-[10px] font-medium text-stone-400">
                    {formatWhen(n.createdAt)}
                  </span>
                </span>
                <span className="text-xs font-medium leading-relaxed text-stone-500">{n.body}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <>
      {isMobile ? (
        <MobileDrawer open={listOpen} onOpenChange={setListOpen}>
          {list}
        </MobileDrawer>
      ) : (
        <DropdownMenu open={open} onOpenChange={setOpen}>
          <DropdownMenuTrigger asChild>{bell}</DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            sideOffset={10}
            className="max-h-[60vh] w-[340px] overflow-y-auto p-2"
          >
            {list}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </>
  );
}