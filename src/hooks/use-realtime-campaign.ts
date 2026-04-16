"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Subscribes to Supabase Realtime broadcast events for a specific campaign.
 *
 * Returns version counters that increment on each event — use them as
 * `useEffect` dependencies in child components to trigger targeted refetches.
 *
 * Debounces rapid events (e.g. batch pipeline processing) into a single
 * version bump per 500ms window to prevent fetch storms.
 *
 * Channel: `campaign:<campaignId>`
 * Events:  `pipeline` (posts/jobs changed), `counters` (campaign stats changed)
 */

export type RealtimeConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected";

interface UseRealtimeCampaignResult {
  /** Increments when posts or jobs change */
  pipelineVersion: number;
  /** Increments when campaign counters change */
  countersVersion: number;
  /** Current WebSocket connection state */
  status: RealtimeConnectionStatus;
}

const DEBOUNCE_MS = 500;

export function useRealtimeCampaign(
  campaignId: string | null,
): UseRealtimeCampaignResult {
  const [pipelineVersion, setPipelineVersion] = useState(0);
  const [countersVersion, setCountersVersion] = useState(0);
  const [status, setStatus] = useState<RealtimeConnectionStatus>("disconnected");

  const pipelineTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countersTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!campaignId) {
      setStatus("disconnected");
      return;
    }

    const supabase = createClient();
    const channelName = `campaign:${campaignId}`;

    setStatus("connecting");

    const channel = supabase
      .channel(channelName)
      .on("broadcast", { event: "pipeline" }, () => {
        if (pipelineTimerRef.current) clearTimeout(pipelineTimerRef.current);
        pipelineTimerRef.current = setTimeout(() => {
          setPipelineVersion((v) => v + 1);
        }, DEBOUNCE_MS);
      })
      .on("broadcast", { event: "counters" }, () => {
        if (countersTimerRef.current) clearTimeout(countersTimerRef.current);
        countersTimerRef.current = setTimeout(() => {
          setCountersVersion((v) => v + 1);
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
      if (pipelineTimerRef.current) clearTimeout(pipelineTimerRef.current);
      if (countersTimerRef.current) clearTimeout(countersTimerRef.current);
      setStatus("disconnected");
    };
  }, [campaignId]);

  // Reset versions when campaign changes
  useEffect(() => {
    setPipelineVersion(0);
    setCountersVersion(0);
  }, [campaignId]);

  return { pipelineVersion, countersVersion, status };
}
