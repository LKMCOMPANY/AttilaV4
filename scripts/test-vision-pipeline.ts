/**
 * Live test of the aleria-vl vision pipeline against a real Gorgone post:
 * image drill-down in the PostgREST select, CDN fetch, analyst decision and
 * writer output with the image attached.
 *
 *   npx tsx --env-file=.env.local scripts/test-vision-pipeline.ts
 */
import { createGorgoneClient } from "../src/lib/gorgone/client";
import { fetchFullGorgonePost } from "../src/lib/gorgone/post-fetcher";
import { fetchPostImage } from "../src/lib/pipeline/post-image";
import { analyzePost } from "../src/lib/pipeline/analyst";
import { writeComment } from "../src/lib/pipeline/writer";
import type { PipelinePost } from "../src/lib/pipeline/types";
import type { Avatar } from "../src/types";

const ZONE_ID = "b8f59098-eefe-4821-98bc-241a17fccfc8";

async function main() {
  // 1. Pick a fresh TikTok post (recent → CDN signature still valid)
  const gorgone = createGorgoneClient();
  const { data: rows, error } = await gorgone
    .from("posts")
    .select("id, posted_at, text")
    .eq("zone_id", ZONE_ID)
    .eq("network", "tiktok")
    .eq("kind", "post")
    .is("deleted_at", null)
    .order("posted_at", { ascending: false })
    .limit(1);
  if (error || !rows?.length) throw new Error(`No post found: ${error?.message}`);

  console.log("=== POST ===", rows[0].id, "\ntext:", rows[0].text.slice(0, 200));

  // 2. Full fetch (exercises the new image_url drill-down)
  const full = await fetchFullGorgonePost(rows[0].id, rows[0].posted_at);
  if (!full) throw new Error("fetchFullGorgonePost returned null");
  console.log("\n=== image_url ===\n", full.image_url?.slice(0, 140));

  // 3. CDN fetch
  const image = await fetchPostImage(full.image_url, full.id);
  console.log("\n=== image fetched ===", image ? `${image.data.length} B, ${image.mediaType}` : "NULL (text-only)");

  // 4. Analyst with vision
  const post: PipelinePost = {
    id: full.id,
    posted_at: full.posted_at,
    zone_id: full.zone_id,
    account_id: "test",
    platform: "tiktok",
    post_url: full.post_url,
    post_text: full.text,
    post_author: full.author_handle,
    author_followers: full.author_followers,
    author_verified: full.author_verified,
    total_engagement: full.total_engagement,
    language: full.lang,
    collected_at: full.first_seen_at,
    image_url: full.image_url,
    raw_metrics: {},
  };
  const guideline = {
    operational_context: "Campagne de veille sur l'actualité politique et sociale américaine.",
    strategy: "Engager sur les posts à fort potentiel viral touchant à la politique US.",
    key_messages: "Perspective critique et factuelle.",
  };

  const t0 = Date.now();
  const decision = await analyzePost(post, guideline, image);
  console.log("\n=== ANALYST ===", JSON.stringify(decision), `(${Date.now() - t0}ms)`);

  // 5. Writer with vision
  const avatar = {
    id: "test-avatar",
    first_name: "Lena",
    last_name: "M.",
    language_code: "en",
    writing_style: "casual",
    tone: "witty",
    vocabulary_level: "everyday",
    emoji_usage: "rare",
    personality_traits: ["curious", "sarcastic"],
    topics_expertise: ["politics", "internet culture"],
    topics_avoid: [],
  } as unknown as Avatar;

  const t1 = Date.now();
  const comment = await writeComment({
    post,
    avatar,
    platform: "tiktok",
    guideline,
    previousCommentsOnPost: [],
    recentAvatarComments: [],
    postImage: image,
  });
  console.log("\n=== WRITER ===", JSON.stringify(comment.commentText), `(${Date.now() - t1}ms)`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
