"use server";

/**
 * Cartography — Server Action
 *
 * Fetches all avatars for an account with their relations and usage metrics,
 * then precomputes cluster keys for every clustering dimension.
 */

import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import type {
  CartographyData,
  ConstellationNode,
  ConstellationAvatarSnapshot,
  ClusterDimension,
} from "@/types/cartography";

// ---------------------------------------------------------------------------
// Public action
// ---------------------------------------------------------------------------

export async function getCartographyData(
  accountId: string
): Promise<{ data: CartographyData | null; error: string | null }> {
  try {
    const session = await requireSession();

    if (
      session.profile.role !== "admin" &&
      session.profile.account_id !== accountId
    ) {
      return { data: null, error: "Forbidden" };
    }

    const supabase = await createClient();

    const [avatarResult, jobsResult, contentResult, armyResult, campaignResult] =
      await Promise.all([
        supabase
          .from("avatars")
          .select(
            `*,
            device:devices(id, state),
            avatar_armies(army:armies(id, name)),
            avatar_operators(operator:profiles(id, display_name, email))`
          )
          .eq("account_id", accountId)
          .order("created_at", { ascending: false }),

        supabase
          .from("campaign_jobs")
          .select("avatar_id, status, campaign_id")
          .eq("account_id", accountId),

        supabase
          .from("content_items")
          .select("avatar_id")
          .eq("account_id", accountId)
          .not("avatar_id", "is", null),

        supabase
          .from("armies")
          .select("id", { count: "exact", head: true })
          .eq("account_id", accountId),

        supabase
          .from("campaigns")
          .select("id, name")
          .eq("account_id", accountId),
      ]);

    if (avatarResult.error) {
      return { data: null, error: avatarResult.error.message };
    }

    // Campaign name lookup
    const campaignNames = new Map<string, string>();
    for (const c of campaignResult.data ?? []) {
      campaignNames.set(c.id, c.name);
    }

    // Job stats per avatar + primary campaign (most jobs)
    const jobStats = new Map<string, { total: number; done: number }>();
    const avatarCampaigns = new Map<string, Map<string, number>>();

    for (const job of jobsResult.data ?? []) {
      const entry = jobStats.get(job.avatar_id) ?? { total: 0, done: 0 };
      entry.total++;
      if (job.status === "done") entry.done++;
      jobStats.set(job.avatar_id, entry);

      if (job.campaign_id) {
        const campMap = avatarCampaigns.get(job.avatar_id) ?? new Map();
        campMap.set(job.campaign_id, (campMap.get(job.campaign_id) ?? 0) + 1);
        avatarCampaigns.set(job.avatar_id, campMap);
      }
    }

    // Content count per avatar
    const contentCounts = new Map<string, number>();
    for (const item of contentResult.data ?? []) {
      if (item.avatar_id) {
        contentCounts.set(item.avatar_id, (contentCounts.get(item.avatar_id) ?? 0) + 1);
      }
    }

    // Transform rows into ConstellationNodes
    const nodes: ConstellationNode[] = (avatarResult.data ?? []).map(
      (row: Record<string, unknown>) => {
        const armies = (
          (row.avatar_armies as Record<string, unknown>[] | null) ?? []
        )
          .map((aa) => aa.army as { id: string; name: string } | null)
          .filter(Boolean) as { id: string; name: string }[];

        const operators = (
          (row.avatar_operators as Record<string, unknown>[] | null) ?? []
        )
          .map((ao) => {
            const op = ao.operator as Record<string, unknown> | null;
            if (!op) return null;
            return {
              id: op.id as string,
              name: (op.display_name as string) || (op.email as string),
            };
          })
          .filter(Boolean) as { id: string; name: string }[];

        const device = row.device as { id: string; state: string } | null;
        const avatarId = row.id as string;
        const stats = jobStats.get(avatarId) ?? { total: 0, done: 0 };
        const contentCount = contentCounts.get(avatarId) ?? 0;

        // Resolve primary campaign for this avatar
        const campMap = avatarCampaigns.get(avatarId);
        let primaryCampaignName: string | null = null;
        if (campMap && campMap.size > 0) {
          let maxJobs = 0;
          let maxCampId = "";
          for (const [cid, count] of campMap) {
            if (count > maxJobs) {
              maxJobs = count;
              maxCampId = cid;
            }
          }
          primaryCampaignName = campaignNames.get(maxCampId) ?? null;
        }

        const enabledPlatforms = [
          row.twitter_enabled && "twitter",
          row.tiktok_enabled && "tiktok",
          row.reddit_enabled && "reddit",
          row.instagram_enabled && "instagram",
        ].filter(Boolean) as string[];

        const snapshot: ConstellationAvatarSnapshot = {
          id: avatarId,
          firstName: row.first_name as string,
          lastName: row.last_name as string,
          profileImageUrl: row.profile_image_url as string | null,
          countryCode: row.country_code as string,
          languageCode: row.language_code as string,
          status: row.status as string,
          writingStyle: row.writing_style as string,
          tone: row.tone as string,
          vocabularyLevel: row.vocabulary_level as string,
          emojiUsage: row.emoji_usage as string,
          personalityTraits: (row.personality_traits as string[]) ?? [],
          topicsExpertise: (row.topics_expertise as string[]) ?? [],
          tags: (row.tags as string[]) ?? [],
          twitterEnabled: row.twitter_enabled as boolean,
          tiktokEnabled: row.tiktok_enabled as boolean,
          redditEnabled: row.reddit_enabled as boolean,
          instagramEnabled: row.instagram_enabled as boolean,
          deviceId: device?.id ?? null,
          deviceState: device?.state ?? null,
          armies,
          operators,
          createdAt: row.created_at as string,
        };

        const clusters = buildClusterKeys(
          snapshot, armies, operators, enabledPlatforms, stats, primaryCampaignName
        );

        return {
          id: avatarId,
          label: `${row.first_name} ${row.last_name}`.trim(),
          profileImageUrl: row.profile_image_url as string | null,
          clusters,
          automatorJobs: stats.total,
          automatorSuccessRate: stats.total > 0 ? stats.done / stats.total : 0,
          operatorCount: operators.length,
          contentItemCount: contentCount,
          platformCount: enabledPlatforms.length,
          armyCount: armies.length,
          avatar: snapshot,
        } satisfies ConstellationNode;
      }
    );

    return {
      data: {
        nodes,
        totalAvatars: nodes.length,
        totalArmies: armyResult.count ?? 0,
        totalCampaigns: (campaignResult.data ?? []).length,
      },
      error: null,
    };
  } catch (err) {
    console.error("[Cartography] Error:", err);
    return {
      data: null,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

// ---------------------------------------------------------------------------
// Cluster key builder
// ---------------------------------------------------------------------------

function buildClusterKeys(
  snapshot: ConstellationAvatarSnapshot,
  armies: { id: string; name: string }[],
  operators: { id: string; name: string }[],
  enabledPlatforms: string[],
  jobStats: { total: number; done: number },
  primaryCampaignName: string | null
): Record<ClusterDimension, string> {
  const armyKey = armies.length > 0 ? armies[0].name : "Unassigned";

  const statusKey = capitalize(snapshot.status);

  const identityKey = `${snapshot.countryCode.toUpperCase()} · ${snapshot.languageCode.toUpperCase()}`;

  const personalityKey = `${capitalize(snapshot.writingStyle)} · ${capitalize(snapshot.tone)}`;

  // Operator: cluster by WHO operates them
  const operatorKey = operators.length > 0
    ? operators[0].name
    : "Unassigned";

  // Automator: cluster by WHICH campaign uses them
  const automatorKey = primaryCampaignName ?? "Unused";

  const platformKey =
    enabledPlatforms.length === 0
      ? "No platform"
      : enabledPlatforms.map(capitalize).join(" + ");

  let deviceKey: string;
  if (!snapshot.deviceId) deviceKey = "No device";
  else if (snapshot.deviceState === "running") deviceKey = "Running";
  else if (snapshot.deviceState === "stopped") deviceKey = "Stopped";
  else deviceKey = capitalize(snapshot.deviceState ?? "unknown");

  return {
    army: armyKey,
    status: statusKey,
    identity: identityKey,
    personality: personalityKey,
    operator_usage: operatorKey,
    automator_usage: automatorKey,
    platform: platformKey,
    device: deviceKey,
  };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
