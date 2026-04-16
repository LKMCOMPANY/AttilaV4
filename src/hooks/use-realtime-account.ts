"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { RealtimeConnectionStatus } from "./use-realtime-campaign";

/**
 * Subscribes to Supabase Realtime broadcast events for an account.
 * Used by the Operator page to track avatar/device automator activity.
 *
 * Channel: `account:<accountId>`
 * Events:  `jobs` (campaign jobs created, completed, purged)
 */

const DEBOUNCE_MS = 500;

export function useRealtimeAccount(accountId: string) {
  const [jobsVersion, setJobsVersion] = useState(0);
  const [status, setStatus] = useState<RealtimeConnectionStatus>("disconnected");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const supabase = createClient();
    const channelName = `account:${accountId}`;

    setStatus("connecting");

    const channel = supabase
      .channel(channelName)
      .on("broadcast", { event: "jobs" }, () => {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          setJobsVersion((v) => v + 1);
        }, DEBOUNCE_MS);
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

    return () => {
      supabase.removeChannel(channel);
      if (timerRef.current) clearTimeout(timerRef.current);
      setStatus("disconnected");
    };
  }, [accountId]);

  return { jobsVersion, status };
}
