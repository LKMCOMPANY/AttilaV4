"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  acknowledgeAttentionItem,
  listAttentionItems,
  markAttentionItemDone,
  resolveAttentionItem,
} from "@/app/actions/attention";
import type { AttentionQueueItem } from "@/types";

/**
 * The attention queue of the workspace: loaded once, refetched on the
 * `attention` realtime tick (`attentionVersion`), patched in place after a
 * mutation so the surface converges before the tick lands. The order is the
 * server's (`attention_queue_v.priority`) — never re-ranked here.
 */

export interface AttentionQueue {
  items: AttentionQueueItem[];
  loading: boolean;
  error: string | null;
  /** Open items keyed by avatar id (account scope only). */
  byAvatar: Record<string, AttentionQueueItem[]>;
  reload: () => Promise<void>;
  acknowledge: (item: AttentionQueueItem) => Promise<void>;
  markDone: (item: AttentionQueueItem) => Promise<void>;
  resolve: (item: AttentionQueueItem) => Promise<void>;
}

export function useAttentionQueue(accountId: string, attentionVersion: number): AttentionQueue {
  const [items, setItems] = useState<AttentionQueueItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const next = await listAttentionItems();
      setItems(next);
      setError(null);
    } catch (err) {
      // Keep the last-good list; only a first load shows the failure.
      setError(err instanceof Error ? err.message : "Attention queue unavailable");
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload, accountId, attentionVersion]);

  /**
   * The mutation answers the bare row (no `priority`); the previous row's
   * priority is carried over so the server's order holds until the refetch.
   */
  const patch = useCallback((id: string, updated: AttentionQueueItem | null) => {
    setItems((prev) => {
      if (!prev) return prev;
      const index = prev.findIndex((item) => item.id === id);
      if (index < 0) return prev;
      if (!updated || updated.status === "resolved") {
        return prev.filter((item) => item.id !== id);
      }
      const next = [...prev];
      next[index] = { ...updated, priority: updated.priority ?? prev[index].priority };
      return next;
    });
  }, []);

  const acknowledge = useCallback(
    async (item: AttentionQueueItem) => {
      const result = await acknowledgeAttentionItem(item.id);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      patch(item.id, { ...result.item, priority: item.priority });
    },
    [patch],
  );

  const markDone = useCallback(
    async (item: AttentionQueueItem) => {
      const result = await markAttentionItemDone(item.id);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      patch(item.id, { ...result.item, priority: item.priority });
      toast.success("Marked done — a probe will confirm the fix");
    },
    [patch],
  );

  const resolve = useCallback(
    async (item: AttentionQueueItem) => {
      const result = await resolveAttentionItem(item.id);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      patch(item.id, null);
      toast.success("Resolved");
    },
    [patch],
  );

  const byAvatar = useMemo(() => {
    const map: Record<string, AttentionQueueItem[]> = {};
    for (const item of items ?? []) {
      if (item.scope !== "avatar_platform" || !item.avatar_id) continue;
      (map[item.avatar_id] ??= []).push(item);
    }
    return map;
  }, [items]);

  return useMemo(
    () => ({
      items: items ?? [],
      loading: items === null && error === null,
      error: items === null ? error : null,
      byAvatar,
      reload,
      acknowledge,
      markDone,
      resolve,
    }),
    [items, error, byAvatar, reload, acknowledge, markDone, resolve],
  );
}
