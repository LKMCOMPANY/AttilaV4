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
  const [channelStatus, setChannelStatus] = useState<RealtimeConnectionStatus>("disconnected");

  // With no campaign there is no channel, so the reported status is a
  // derivation rather than something an effect has to write.
  const status: RealtimeConnectionStatus = campaignId ? channelStatus : "disconnected";

  // Counters and connection state belong to one campaign: switching campaigns
  // restarts them. Adjusted during render (React's documented pattern) so a
  // consumer never sees the previous campaign's version or status paired with
  // the new id, and so the effect that opens the channel only ever writes state
  // from its subscription callback.
  const [channelFor, setChannelFor] = useState(campaignId);
  if (channelFor !== campaignId) {
    setChannelFor(campaignId);
    setPipelineVersion(0);
    setCountersVersion(0);
    setChannelStatus(campaignId ? "connecting" : "disconnected");
  }

  const pipelineTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countersTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!campaignId) return;

    const supabase = createClient();
    const channelName = `campaign:${campaignId}`;

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
          setChannelStatus("connected");
        } else if (
          subscriptionStatus === "CLOSED" ||
          subscriptionStatus === "CHANNEL_ERROR"
        ) {
          setChannelStatus("disconnected");
        }
      });

    return () => {
      supabase.removeChannel(channel);
      if (pipelineTimerRef.current) clearTimeout(pipelineTimerRef.current);
      if (countersTimerRef.current) clearTimeout(countersTimerRef.current);
      setChannelStatus("disconnected");
    };
  }, [campaignId]);

  return { pipelineVersion, countersVersion, status };
}
