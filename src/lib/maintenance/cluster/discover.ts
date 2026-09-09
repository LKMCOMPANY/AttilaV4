import { searchTikTokCreators } from "@/lib/social-verify/tikhub";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { SocialPlatform } from "@/types";

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Cluster discovery (phase 3): from the keywords of the avatar's armies to a
 * ranked list of creators the avatar should sit next to. Read-only on the
 * platform (TikHub search), bounded to a few searches a day per avatar, and
 * idempotent — a creator already known keeps its status.
 */

export interface DiscoveryReport {
  keywords: string[];
  searched: number;
  discovered: number;
}

/** Bigger accounts first, but the very largest are not "a cluster" — a soft cap keeps them mid-list. */
export function scoreCandidate(followers: number | null, keywordRank: number): number {
  const size = followers ?? 0;
  const sizeScore = size <= 0 ? 0 : Math.min(1, Math.log10(size) / 6);
  const penalty = size > 2_000_000 ? 0.4 : 0;
  return Math.round((sizeScore - penalty - keywordRank * 0.05) * 1000) / 1000;
}

/** The avatar's cluster keywords: every army's, deduplicated, longest first. */
export async function clusterKeywords(supabase: AdminClient, avatarId: string): Promise<string[]> {
  const { data } = await supabase
    .from("avatar_armies")
    .select("army:armies(brief:army_briefs(cluster_keywords))")
    .eq("avatar_id", avatarId);
  const keywords = new Set<string>();
  for (const row of (data ?? []) as unknown as Array<{ army: { brief: { cluster_keywords: string[] } | { cluster_keywords: string[] }[] | null } | null }>) {
    const brief = Array.isArray(row.army?.brief) ? row.army?.brief[0] : row.army?.brief;
    for (const keyword of brief?.cluster_keywords ?? []) {
      const clean = keyword.trim();
      if (clean) keywords.add(clean);
    }
  }
  return [...keywords].sort((a, b) => b.length - a.length);
}

/**
 * Search each keyword (up to `searchesPerDay`) and store the creators found
 * as candidates. Never overwrites a row the maintainer already acted on.
 */
export async function discoverCandidates(
  supabase: AdminClient,
  avatar: { id: string; account_id: string; tiktok_credentials: { handle?: string } | null },
  platform: SocialPlatform,
  searchesPerDay: number,
): Promise<DiscoveryReport> {
  if (platform !== "tiktok") return { keywords: [], searched: 0, discovered: 0 };
  const keywords = await clusterKeywords(supabase, avatar.id);
  const own = avatar.tiktok_credentials?.handle?.replace(/^@/, "").toLowerCase();
  let searched = 0;
  let discovered = 0;
  for (const [rank, keyword] of keywords.slice(0, Math.max(0, searchesPerDay)).entries()) {
    const creators = await searchTikTokCreators(keyword, 10);
    searched++;
    if (!creators) continue;
    const rows = creators
      .filter((c) => c.uniqueId.toLowerCase() !== own)
      .map((c) => ({
        account_id: avatar.account_id,
        avatar_id: avatar.id,
        platform,
        kind: "creator",
        handle: c.uniqueId,
        display_name: c.nickname,
        followers: c.followers,
        keyword,
        source: "tikhub_search",
        score: scoreCandidate(c.followers, rank),
      }));
    if (rows.length === 0) continue;
    const { data, error } = await supabase
      .from("cluster_candidates")
      .upsert(rows, { onConflict: "avatar_id,platform,kind,handle", ignoreDuplicates: true })
      .select("id");
    if (error) console.error(`[Cluster] candidates upsert failed for ${avatar.id}: ${error.message}`);
    discovered += data?.length ?? 0;
  }
  return { keywords, searched, discovered };
}

/** The best candidate not yet acted on, or null. */
export async function nextCandidate(supabase: AdminClient, avatarId: string, platform: SocialPlatform) {
  const { data } = await supabase
    .from("cluster_candidates")
    .select("id, handle, display_name, score")
    .eq("avatar_id", avatarId)
    .eq("platform", platform)
    .eq("kind", "creator")
    .eq("status", "candidate")
    .order("score", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

export async function markCandidate(
  supabase: AdminClient,
  id: string,
  status: "followed" | "skipped" | "rejected" | "failed",
  taskId: string,
): Promise<void> {
  await supabase.from("cluster_candidates").update({ status, acted_at: new Date().toISOString(), task_id: taskId }).eq("id", id);
}
