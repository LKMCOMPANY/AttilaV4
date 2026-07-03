"use server";

import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import {
  estimateZoneVolume,
  applyCampaignFilters,
  estimateCapacity,
  verifyZoneAccess,
  type CampaignCapacityResult,
} from "@/lib/gorgone";
import type { CampaignFilters, CampaignPlatform, CapacityParams } from "@/types";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface CapacityEstimateInput {
  zone_id: string;
  platforms: CampaignPlatform[];
  filters: CampaignFilters;
  army_ids: string[];
  capacity_params: CapacityParams;
  account_id: string;
}

export interface PlatformCapacityTotals {
  platform: CampaignPlatform;
  result: CampaignCapacityResult;
}

export interface CapacityEstimateResult {
  platforms: PlatformCapacityTotals[];
}

export async function getCapacityEstimate(
  input: CapacityEstimateInput
): Promise<{ data: CapacityEstimateResult | null; error: string | null }> {
  try {
    const session = await requireSession();

    if (
      session.profile.role !== "admin" &&
      input.account_id !== session.profile.account_id
    ) {
      return { data: null, error: "Forbidden" };
    }

    const supabase = await createClient();

    // Zone tenancy check + army counts run while volume queries start.
    const [zoneAllowed, avatarCounts] = await Promise.all([
      verifyZoneAccess(supabase, input.account_id, input.zone_id),
      getArmyAvatarCounts(supabase, input.army_ids),
    ]);
    if (!zoneAllowed) {
      return { data: null, error: "Zone not accessible for this account" };
    }

    const platformResults = await Promise.all(
      input.platforms.map(async (platform): Promise<PlatformCapacityTotals> => {
        const params = input.capacity_params[platform];
        const counts = avatarCounts[platform];

        const zoneData = await estimateZoneVolume(input.zone_id, platform);
        const filtered = applyCampaignFilters(zoneData, input.filters);
        const capacity = estimateCapacity(filtered, {
          total_avatars: counts.total,
          active_avatars: counts.active,
          max_responses_per_avatar_per_hour: params.max_responses_per_hour,
          max_responses_per_avatar_per_day: params.max_responses_per_day,
          min_avatars_per_post: params.min_avatars_per_post,
          max_avatars_per_post: params.max_avatars_per_post,
        });

        return {
          platform,
          result: { volume: zoneData.volume, filtered, capacity },
        };
      })
    );

    return { data: { platforms: platformResults }, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { data: null, error: message };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type AvatarCountsByPlatform = Record<
  CampaignPlatform,
  { total: number; active: number }
>;

/**
 * Counts platform-enabled avatars across the selected armies — one query
 * for both platforms (an avatar in several armies counts once).
 */
async function getArmyAvatarCounts(
  supabase: Awaited<ReturnType<typeof createClient>>,
  armyIds: string[]
): Promise<AvatarCountsByPlatform> {
  const empty: AvatarCountsByPlatform = {
    twitter: { total: 0, active: 0 },
    tiktok: { total: 0, active: 0 },
  };
  if (armyIds.length === 0) return empty;

  const { data, error } = await supabase
    .from("avatar_armies")
    .select("avatar:avatars!avatar_id(id, status, twitter_enabled, tiktok_enabled)")
    .in("army_id", armyIds);

  if (error) throw new Error(`avatar counts: ${error.message}`);
  if (!data) return empty;

  type AvatarRow = {
    id: string;
    status: string;
    twitter_enabled: boolean;
    tiktok_enabled: boolean;
  };
  const seen = new Map<string, AvatarRow>();
  for (const row of data as unknown as { avatar: AvatarRow | null }[]) {
    if (row.avatar && !seen.has(row.avatar.id)) {
      seen.set(row.avatar.id, row.avatar);
    }
  }

  const counts: AvatarCountsByPlatform = {
    twitter: { total: 0, active: 0 },
    tiktok: { total: 0, active: 0 },
  };
  for (const avatar of seen.values()) {
    for (const platform of ["twitter", "tiktok"] as const) {
      const enabled =
        platform === "twitter" ? avatar.twitter_enabled : avatar.tiktok_enabled;
      if (!enabled) continue;
      counts[platform].total++;
      if (avatar.status === "active") counts[platform].active++;
    }
  }
  return counts;
}
