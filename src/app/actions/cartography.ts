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

    // Parallel fetches
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
          .select("avatar_id, status")
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
          .select("id", { count: "exact", head: true })
          .eq("account_id", accountId),
      ]);

    if (avatarResult.error) {
      return { data: null, error: avatarResult.error.message };
    }

    // Build job stats per avatar
    const jobStats = new Map<string, { total: number; done: number }>();
    for (const job of jobsResult.data ?? []) {
      const entry = jobStats.get(job.avatar_id) ?? { total: 0, done: 0 };
      entry.total++;
      if (job.status === "done") entry.done++;
      jobStats.set(job.avatar_id, entry);
    }

    // Build content count per avatar
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
        const stats = jobStats.get(row.id as string) ?? { total: 0, done: 0 };
        const contentCount = contentCounts.get(row.id as string) ?? 0;

        const enabledPlatforms = [
          row.twitter_enabled && "twitter",
          row.tiktok_enabled && "tiktok",
          row.reddit_enabled && "reddit",
          row.instagram_enabled && "instagram",
        ].filter(Boolean) as string[];

        const snapshot: ConstellationAvatarSnapshot = {
          id: row.id as string,
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

        const clusters = buildClusterKeys(snapshot, armies, operators, enabledPlatforms, stats);

        return {
          id: row.id as string,
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
        totalCampaigns: campaignResult.count ?? 0,
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
  jobStats: { total: number; done: number }
): Record<ClusterDimension, string> {
  // Army: primary army (first), or "Unassigned"
  const armyKey = armies.length > 0 ? armies[0].name : "Unassigned";

  // Status: direct
  const statusKey = snapshot.status;

  // Identity: country + language
  const identityKey = `${snapshot.countryCode.toUpperCase()} · ${snapshot.languageCode.toUpperCase()}`;

  // Personality: writing style + tone combo
  const personalityKey = `${capitalize(snapshot.writingStyle)} · ${capitalize(snapshot.tone)}`;

  // Operator usage: bucketed
  const operatorKey = operators.length === 0
    ? "No operator"
    : operators.length === 1
      ? "1 operator"
      : `${operators.length} operators`;

  // Automator usage: bucketed by job count
  let automatorKey: string;
  if (jobStats.total === 0) automatorKey = "Unused";
  else if (jobStats.total <= 5) automatorKey = "Low (1–5)";
  else if (jobStats.total <= 20) automatorKey = "Medium (6–20)";
  else if (jobStats.total <= 50) automatorKey = "High (21–50)";
  else automatorKey = "Very High (50+)";

  // Platform: primary or combo
  const platformKey =
    enabledPlatforms.length === 0
      ? "No platform"
      : enabledPlatforms.map(capitalize).join(" + ");

  // Device: assignment status
  let deviceKey: string;
  if (!snapshot.deviceId) deviceKey = "No device";
  else if (snapshot.deviceState === "running") deviceKey = "Device running";
  else if (snapshot.deviceState === "stopped") deviceKey = "Device stopped";
  else deviceKey = `Device ${snapshot.deviceState ?? "unknown"}`;

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
