"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import type { RealtimeConnectionStatus } from "./use-realtime-campaign";

/**
 * Subscribes to Supabase Realtime for an account:
 *   - Broadcast events: `jobs` (pipeline changes), `devices` (state changes)
 *   - Presence: tracks which operator is viewing which avatar
 *
 * Channel: `account:<accountId>`
 */

const DEBOUNCE_MS = 500;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PresenceState {
  avatarId: string;
  displayName: string;
}

export interface OperatorPresence {
  displayName: string;
}

interface UseRealtimeAccountOptions {
  accountId: string;
  presence?: PresenceState | null;
}

interface UseRealtimeAccountResult {
  jobsVersion: number;
  devicesVersion: number;
  presenceMap: Record<string, OperatorPresence[]>;
  status: RealtimeConnectionStatus;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useRealtimeAccount({
  accountId,
  presence = null,
}: UseRealtimeAccountOptions): UseRealtimeAccountResult {
  const [jobsVersion, setJobsVersion] = useState(0);
  const [devicesVersion, setDevicesVersion] = useState(0);
  const [presenceMap, setPresenceMap] = useState<Record<string, OperatorPresence[]>>({});
  const [status, setStatus] = useState<RealtimeConnectionStatus>("disconnected");

  const jobsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const devicesTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const channelRef = useRef<ReturnType<ReturnType<typeof createClient>["channel"]> | null>(null);

  // Stable serialized presence for dependency tracking
  const presenceKey = presence
    ? `${presence.avatarId}:${presence.displayName}`
    : "";

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel(`account:${accountId}`);

    setStatus("connecting");

    channel
      .on("broadcast", { event: "jobs" }, () => {
        if (jobsTimerRef.current) clearTimeout(jobsTimerRef.current);
        jobsTimerRef.current = setTimeout(() => {
          setJobsVersion((v) => v + 1);
        }, DEBOUNCE_MS);
      })
      .on("broadcast", { event: "devices" }, () => {
        if (devicesTimerRef.current) clearTimeout(devicesTimerRef.current);
        devicesTimerRef.current = setTimeout(() => {
          setDevicesVersion((v) => v + 1);
        }, DEBOUNCE_MS);
      })
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState<PresenceState>();
        const map: Record<string, OperatorPresence[]> = {};
        for (const entries of Object.values(state)) {
          for (const entry of entries) {
            const avatarId = entry.avatarId;
            if (!avatarId) continue;
            const list = map[avatarId] ?? [];
            list.push({ displayName: entry.displayName });
            map[avatarId] = list;
          }
        }
        setPresenceMap(map);
      })
      .subscribe((subscriptionStatus) => {
        if (subscriptionStatus === "SUBSCRIBED") {
          setStatus("connected");
        } else if (
          subscriptionStatus === "CLOSED" ||
          subscriptionStatus === "CHANNEL_ERROR"
        ) {
          setStatus("disconnected");
        }
      });

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
      if (jobsTimerRef.current) clearTimeout(jobsTimerRef.current);
      if (devicesTimerRef.current) clearTimeout(devicesTimerRef.current);
      setStatus("disconnected");
    };
  }, [accountId]);

  // Track presence — update when selected avatar changes
  useEffect(() => {
    const channel = channelRef.current;
    if (!channel) return;

    if (presence) {
      channel.track(presence);
    } else {
      channel.untrack();
    }
  }, [presenceKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return useMemo(
    () => ({ jobsVersion, devicesVersion, presenceMap, status }),
    [jobsVersion, devicesVersion, presenceMap, status],
  );
}
