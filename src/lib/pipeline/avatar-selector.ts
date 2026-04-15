import { createAdminClient } from "@/lib/supabase/admin";
import type { CampaignPlatform, PlatformCapacityParams, Avatar } from "@/types";
import type { SelectedAvatar } from "./types";
import { pipelineLog } from "./types";

const MIN_COOLDOWN_MINUTES = 5;

/**
 * Select available avatars for a campaign post.
 * Single source of truth for "what counts as available".
 */
export async function selectAvatars(params: {
  armyIds: string[];
  platform: CampaignPlatform;
  capacityParams: PlatformCapacityParams;
  requestedCount: number;
  accountId: string;
  excludeAvatarIds?: string[];
}): Promise<SelectedAvatar[]> {
  const {
    armyIds,
    platform,
    capacityParams,
    requestedCount,
    accountId,
    excludeAvatarIds = [],
  } = params;

  const count = Math.min(
    Math.max(requestedCount, capacityParams.min_avatars_per_post),
    capacityParams.max_avatars_per_post,
  );

  const supabase = createAdminClient();

  // 1. Get avatar IDs from the armies
  const { data: armyLinks } = await supabase
    .from("avatar_armies")
    .select("avatar_id")
    .in("army_id", armyIds);

  if (!armyLinks || armyLinks.length === 0) {
    pipelineLog("selector", null, "No avatars in armies", { armyIds });
    return [];
  }

  const armyAvatarIds = armyLinks.map((l) => l.avatar_id);

  // 2. Load eligible avatars with their device + box
  const platformEnabledCol = platform === "twitter" ? "twitter_enabled" : "tiktok_enabled";

  const { data: avatars } = await supabase
    .from("avatars")
    .select("*, device:devices!avatars_device_id_fkey(id, box_id, state)")
    .in("id", armyAvatarIds)
    .eq("status", "active")
    .eq(platformEnabledCol, true)
    .not("device_id", "is", null)
    .eq("account_id", accountId);

  if (!avatars || avatars.length === 0) {
    pipelineLog("selector", null, "No eligible avatars after basic filters");
    return [];
  }

  // 3. Filter out excluded avatars and those with blocked tags
  const blockedTag = `blocked_${platform}`;
  const eligible = avatars.filter((a) => {
    if (excludeAvatarIds.includes(a.id)) return false;
    const tags: string[] = Array.isArray(a.tags) ? a.tags : [];
    if (tags.includes(blockedTag)) return false;
    return true;
  });

  if (eligible.length === 0) {
    pipelineLog("selector", null, "All avatars excluded or blocked");
    return [];
  }

  // 4. Check rate limits and busy status — batch query for all eligible avatars
  const eligibleIds = eligible.map((a) => a.id);
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const cooldownCutoff = new Date(now.getTime() - MIN_COOLDOWN_MINUTES * 60 * 1000).toISOString();

  // Get job counts and busy status in one query
  const { data: recentJobs } = await supabase
    .from("campaign_jobs")
    .select("avatar_id, status, created_at")
    .in("avatar_id", eligibleIds)
    .gte("created_at", oneDayAgo);

  const jobsByAvatar = new Map<string, { hourly: number; daily: number; busy: boolean; lastJobAt: string | null }>();

  for (const avatarId of eligibleIds) {
    jobsByAvatar.set(avatarId, { hourly: 0, daily: 0, busy: false, lastJobAt: null });
  }

  if (recentJobs) {
    for (const job of recentJobs) {
      const entry = jobsByAvatar.get(job.avatar_id);
      if (!entry) continue;

      if (job.status === "ready" || job.status === "executing") {
        entry.busy = true;
      }

      entry.daily++;
      if (job.created_at >= oneHourAgo) {
        entry.hourly++;
      }

      if (!entry.lastJobAt || job.created_at > entry.lastJobAt) {
        entry.lastJobAt = job.created_at;
      }
    }
  }

  // 5. Score and rank available avatars
  const scored: Array<{ avatar: (typeof eligible)[number]; score: number }> = [];

  for (const avatar of eligible) {
    const stats = jobsByAvatar.get(avatar.id);
    if (!stats) continue;

    if (stats.busy) continue;
    if (stats.hourly >= capacityParams.max_responses_per_hour) continue;
    if (stats.daily >= capacityParams.max_responses_per_day) continue;
    if (stats.lastJobAt && stats.lastJobAt >= cooldownCutoff) continue;

    // Score: prefer avatars with lower daily usage and more rest time
    const dailyUsageScore = 1 - stats.daily / capacityParams.max_responses_per_day;
    const restScore = stats.lastJobAt
      ? Math.min((now.getTime() - new Date(stats.lastJobAt).getTime()) / (24 * 60 * 60 * 1000), 1)
      : 1;
    const randomScore = Math.random() * 0.3;

    scored.push({ avatar, score: dailyUsageScore * 0.4 + restScore * 0.3 + randomScore });
  }

  // Sort by score descending, take top N, then shuffle for natural ordering
  scored.sort((a, b) => b.score - a.score);
  const selected = scored.slice(0, count);
  shuffleArray(selected);

  pipelineLog("selector", null, "Selection complete", {
    eligible: eligible.length,
    available: scored.length,
    selected: selected.length,
    requested: count,
  });

  return selected.map((s) => ({
    avatar: s.avatar as Avatar,
    device_id: s.avatar.device_id!,
    box_id: (s.avatar.device as { id: string; box_id: string })?.box_id,
  }));
}

function shuffleArray<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
