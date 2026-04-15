"use server";

import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import {
  estimateZoneVolume,
  applyFilters,
  estimateCapacity,
} from "@/lib/gorgone/capacity-estimator";
import type { EstimatorFilters, CampaignCapacityResult } from "@/lib/gorgone/types";
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

    const estimatorFilters = campaignFiltersToEstimatorFilters(
      input.filters,
      input.platforms
    );

    const platformResults: PlatformCapacityTotals[] = [];

    for (const platform of input.platforms) {
      const params = input.capacity_params[platform];

      const { totalAvatars, activeAvatars } =
        await getArmyAvatarCountsByPlatform(input.army_ids, platform);

      const volume = await estimateZoneVolume(input.zone_id, platform);
      const filtered = applyFilters(volume, estimatorFilters);
      const capacity = estimateCapacity(filtered, {
        total_avatars: totalAvatars,
        active_avatars: activeAvatars,
        max_responses_per_avatar_per_hour: params.max_responses_per_hour,
        max_responses_per_avatar_per_day: params.max_responses_per_day,
        min_avatars_per_post: params.min_avatars_per_post,
        max_avatars_per_post: params.max_avatars_per_post,
      });

      platformResults.push({
        platform,
        result: { volume, filtered, capacity },
      });
    }

    return { data: { platforms: platformResults }, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { data: null, error: message };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PLATFORM_ENABLED_FIELD: Record<CampaignPlatform, string> = {
  twitter: "twitter_enabled",
  tiktok: "tiktok_enabled",
};

async function getArmyAvatarCountsByPlatform(
  armyIds: string[],
  platform: CampaignPlatform
): Promise<{ totalAvatars: number; activeAvatars: number }> {
  if (armyIds.length === 0) {
    return { totalAvatars: 0, activeAvatars: 0 };
  }

  const supabase = await createClient();
  const enabledField = PLATFORM_ENABLED_FIELD[platform];

  const { data } = await supabase
    .from("avatar_armies")
    .select("avatar:avatars!avatar_id(id, status, twitter_enabled, tiktok_enabled)")
    .in("army_id", armyIds);

  if (!data) return { totalAvatars: 0, activeAvatars: 0 };

  type AvatarRow = {
    id: string;
    status: string;
    twitter_enabled: boolean;
    tiktok_enabled: boolean;
  };
  type Row = { avatar: AvatarRow | null };
  const rows = data as unknown as Row[];

  const seen = new Map<string, AvatarRow>();
  for (const row of rows) {
    if (row.avatar && !seen.has(row.avatar.id)) {
      seen.set(row.avatar.id, row.avatar);
    }
  }

  let totalAvatars = 0;
  let activeAvatars = 0;
  for (const avatar of seen.values()) {
    const enabled = avatar[enabledField as keyof AvatarRow] as boolean;
    if (!enabled) continue;
    totalAvatars++;
    if (avatar.status === "active") activeAvatars++;
  }

  return { totalAvatars, activeAvatars };
}

function campaignFiltersToEstimatorFilters(
  filters: CampaignFilters,
  platforms: CampaignPlatform[]
): EstimatorFilters {
  return {
    platforms,
    post_types: filters.post_types,
    exclude_ads: filters.exclude_ads,
    exclude_private: filters.exclude_private,
    min_play_count: filters.min_play_count,
    min_comment_count: filters.min_comment_count,
    min_author_followers: filters.min_author_followers,
    verified_only: filters.verified_only,
    languages: filters.languages,
    min_engagement: filters.min_engagement,
    min_like_count: filters.min_like_count,
    min_view_count: filters.min_view_count,
  };
}
