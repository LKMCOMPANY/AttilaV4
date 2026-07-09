import { createAdminClient } from "@/lib/supabase/admin";
import { broadcastCampaignEvent } from "@/lib/supabase/realtime";
import {
  isTikHubEnabled,
  verifyTweetReply,
  verifyTikTokComment,
} from "@/lib/social-verify/tikhub";

/**
 * Off-device verification pass (TikHub).
 *
 * The on-device gate can over-report success — most acutely on Twitter, where
 * "the composer closed" does not prove the reply landed (a shadow-ban / silent
 * drop looks identical on-device). This sweep re-reads the target from TikHub
 * and records an independent verdict on each `done` job:
 *
 *   confirmed   — our comment/reply is present on the target
 *   unconfirmed — checked, absent (silent drop) → surfaced as an amber badge
 *   unchecked   — TikHub unreachable or key absent (we simply don't know)
 *
 * It NEVER flips `status` (no re-posting, so no double-post risk) — it only
 * annotates `verification`, so the dashboard can distinguish a confirmed post
 * from an on-device-only "done".
 */

// Give the platform time to index the fresh post before the first check, and
// stop re-checking once it's clearly not coming (a confirmed post indexes fast;
// 2h of absence is a definitive silent-drop verdict, not indexing lag).
const MIN_AGE_MS = 90_000;
const MAX_AGE_MS = 2 * 60 * 60 * 1000;
const BATCH = 10;

// After an inconclusive attempt (TikHub unreachable, or a TikTok comment buried
// below the scan budget) the job stays `unchecked` — but we stamp `verified_at`
// and skip it for this long before retrying. Without the cooldown the sweep
// would re-pick the same oldest stuck jobs every cycle (ordered by
// completed_at), burning paid API calls and starving fresh jobs.
const RECHECK_COOLDOWN_MS = 20 * 60 * 1000;

interface VerifiableJob {
  id: string;
  campaign_id: string;
  platform: "twitter" | "tiktok";
  post_url: string | null;
  comment_text: string | null;
  avatar_id: string | null;
}

/** `.../video/<awemeId>` (TikTok) or `.../status/<tweetId>` (Twitter). */
function idFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = /(?:\/video\/|\/status\/)(\d+)/.exec(url);
  return m ? m[1] : null;
}

export interface VerifyPassResult {
  checked: number;
  confirmed: number;
  unconfirmed: number;
  skipped: number;
}

export async function verifyDoneJobs(): Promise<VerifyPassResult> {
  const result: VerifyPassResult = { checked: 0, confirmed: 0, unconfirmed: 0, skipped: 0 };
  if (!isTikHubEnabled()) return result;

  const supabase = createAdminClient();
  const now = Date.now();

  const { data: jobs } = await supabase
    .from("campaign_jobs")
    .select("id, campaign_id, platform, post_url, comment_text, avatar_id")
    .eq("status", "done")
    .eq("verification", "unchecked")
    .lt("completed_at", new Date(now - MIN_AGE_MS).toISOString())
    .gt("completed_at", new Date(now - MAX_AGE_MS).toISOString())
    // Skip jobs re-checked within the cooldown so an inconclusive attempt
    // (TikHub down, comment buried) doesn't hot-loop on the same rows.
    .or(`verified_at.is.null,verified_at.lt.${new Date(now - RECHECK_COOLDOWN_MS).toISOString()}`)
    .order("completed_at", { ascending: true })
    .limit(BATCH);

  if (!jobs || jobs.length === 0) return result;

  for (const job of jobs as VerifiableJob[]) {
    const verdict = await verifyOne(supabase, job);
    if (verdict === "confirmed") result.confirmed++;
    else if (verdict === "unconfirmed") result.unconfirmed++;
    else result.skipped++;
    if (verdict !== "skipped") result.checked++;
  }

  return result;
}

async function verifyOne(
  supabase: ReturnType<typeof createAdminClient>,
  job: VerifiableJob,
): Promise<"confirmed" | "unconfirmed" | "skipped"> {
  const targetId = idFromUrl(job.post_url);
  if (!targetId || !job.comment_text || !job.avatar_id) return "skipped";

  const credCol = job.platform === "twitter" ? "twitter_credentials" : "tiktok_credentials";
  const { data: avatar } = await supabase
    .from("avatars")
    .select(credCol)
    .eq("id", job.avatar_id)
    .single();
  const handle = (avatar as Record<string, { handle?: string } | null> | null)?.[credCol]?.handle ?? null;

  const check = job.platform === "twitter"
    ? await verifyTweetReply({ screenName: handle ?? "", targetTweetId: targetId, text: job.comment_text })
    : await verifyTikTokComment({ awemeId: targetId, handle, text: job.comment_text });

  // Twitter needs the avatar's own handle to read its reply timeline; without
  // it we can't check (leave unchecked rather than falsely "unconfirmed").
  // Stamp verified_at on the inconclusive path too, so the cooldown filter
  // paces the retry instead of re-picking this row every cycle.
  if (!check.available || (job.platform === "twitter" && !handle)) {
    await supabase
      .from("campaign_jobs")
      .update({ verified_at: new Date().toISOString() })
      .eq("id", job.id);
    return "skipped";
  }

  const verification = check.confirmed ? "confirmed" : "unconfirmed";
  const update: {
    verification: string;
    verified_at: string;
    published_url?: string;
  } = { verification, verified_at: new Date().toISOString() };

  // On a confirmed Twitter reply, TikHub gives us the reply's tweet id — persist
  // a direct link to the avatar's OWN published reply. (X resolves a status by
  // its id even if the handle in the path is off, so this is robust to a stale
  // stored handle.) TikTok has no stable per-comment URL, so we skip it there.
  if (check.confirmed && job.platform === "twitter" && handle && "tweetId" in check && check.tweetId) {
    update.published_url = `https://x.com/${handle.replace(/^@/, "")}/status/${check.tweetId}`;
  }

  await supabase.from("campaign_jobs").update(update).eq("id", job.id);

  console.log(`[Verify][${job.id}] ${job.platform} ${verification}`, JSON.stringify({
    handle,
    targetId,
    via: check.confirmed ? check.via : "absent_from_target",
  }));
  broadcastCampaignEvent(job.campaign_id, "pipeline", { action: "job_verified", verification });

  return verification;
}
