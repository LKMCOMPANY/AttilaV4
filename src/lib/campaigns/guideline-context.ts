import { createGorgoneClient } from "@/lib/gorgone";
import {
  GUIDELINE_LOCALES,
  type ContextEntity,
  type ContextPostSample,
  type ContextSentimentBalance,
  type GuidelineContext,
  type GuidelineLocale,
} from "./guideline-types";
import type { Campaign, GorgoneNetwork } from "@/types";

/**
 * Builds the contextual snapshot the LLM needs to write campaign
 * guidelines. Pulls everything from the canonical Gorgone V4 schema:
 *
 *   accounts.locale          — language for the output
 *   zones.description        — the brief
 *   posts (24h window)       — text + engagement + sentiment + lang
 *   post_ai_classifications  — sentiment label / score
 *   entities                 — top actors / orgs / places (the table
 *                              already aggregates `occurrence_count`
 *                              per (zone, entity) so we don't re-sum)
 *
 * Side-effect-free apart from Supabase reads. All inputs are
 * server-resolved (caller passes the already-validated Gorgone account
 * id + zone id) so this layer doesn't re-do scope checks.
 */

const PERIOD_HOURS = 24;
const POSTS_SAMPLE_LIMIT = 60;
const ENTITIES_LIMIT = 25;

interface BuildContextInput {
  campaign: Pick<Campaign, "name" | "platforms">;
  zoneId: string;
  /** Gorgone V4 account uuid this zone belongs to. */
  gorgoneAccountId: string;
}

export async function buildGuidelineContext(
  input: BuildContextInput,
): Promise<GuidelineContext> {
  const gorgone = createGorgoneClient();

  // 1) Account locale + zone metadata. Two pinpoint reads — small.
  const [accountResult, zoneResult] = await Promise.all([
    gorgone
      .from("accounts")
      .select("locale")
      .eq("id", input.gorgoneAccountId)
      .single(),
    gorgone
      .from("zones")
      .select("name, description")
      .eq("id", input.zoneId)
      .single(),
  ]);

  if (zoneResult.error || !zoneResult.data) {
    throw new Error(`Zone ${input.zoneId} not found in Gorgone`);
  }

  const locale = normaliseLocale(accountResult.data?.locale);

  // 2) Window anchor — most recent first_seen_at across networks for
  // this zone. Mirrors the same anchoring strategy the capacity
  // estimator uses (`resolveWindowStart` in `lib/gorgone/capacity-queries`).
  // Anchored on observation (not now) so a zone whose collection paused
  // still produces a sample.
  const since = await resolveSinceTimestamp(gorgone, input.zoneId);

  // 3) Sentiment balance + posts sample come from a single SELECT.
  // We over-pull a bit (POSTS_SAMPLE_LIMIT * 2 lookups for variety)
  // and then materialise the in-prompt slice in `guideline-prompt`.
  const { posts, sentimentBalance } = await fetchSampleAndBalance(
    gorgone,
    input.zoneId,
    since,
  );

  // 4) Top entities — a NER aggregation over the same window.
  const topEntities = await fetchTopEntities(gorgone, input.zoneId, since);

  return {
    campaign: {
      name: input.campaign.name,
      platforms: input.campaign.platforms,
    },
    zone: {
      name: zoneResult.data.name as string,
      description: (zoneResult.data.description ?? null) as string | null,
    },
    locale,
    windowHours: PERIOD_HOURS,
    postsSampled: posts.length,
    sentimentBalance,
    posts,
    topEntities,
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

type GorgoneClient = ReturnType<typeof createGorgoneClient>;

function normaliseLocale(raw: unknown): GuidelineLocale {
  if (typeof raw === "string") {
    const lower = raw.toLowerCase();
    if ((GUIDELINE_LOCALES as readonly string[]).includes(lower)) {
      return lower as GuidelineLocale;
    }
  }
  return "en";
}

async function resolveSinceTimestamp(
  gorgone: GorgoneClient,
  zoneId: string,
): Promise<string> {
  const { data } = await gorgone
    .from("posts")
    .select("first_seen_at")
    .eq("zone_id", zoneId)
    .is("deleted_at", null)
    .order("first_seen_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data?.first_seen_at) {
    return new Date(Date.now() - PERIOD_HOURS * 3_600_000).toISOString();
  }
  const latest = new Date(data.first_seen_at as string).getTime();
  return new Date(latest - PERIOD_HOURS * 3_600_000).toISOString();
}

interface RawPostRow {
  text: string | null;
  network: GorgoneNetwork;
  lang: string | null;
  likes: number | null;
  retweets: number | null;
  replies: number | null;
  quotes: number | null;
  post_ai_classifications:
    | { label: string | null; score: number | null }[]
    | null;
}

async function fetchSampleAndBalance(
  gorgone: GorgoneClient,
  zoneId: string,
  since: string,
): Promise<{ posts: ContextPostSample[]; sentimentBalance: ContextSentimentBalance }> {
  // Order by engagement so the model sees the loudest signal first.
  // Limit caps both the sample and (cheaply) the sentiment count's
  // sample size — a 60-post window is plenty for a directional read.
  const { data } = await gorgone
    .from("posts")
    .select(
      `text, network, lang, likes, retweets, replies, quotes,
       post_ai_classifications(label, score)`,
    )
    .eq("zone_id", zoneId)
    .is("deleted_at", null)
    .gte("first_seen_at", since)
    .order("likes", { ascending: false })
    .limit(POSTS_SAMPLE_LIMIT * 2);

  const rows = ((data ?? []) as unknown as RawPostRow[]).filter(
    (r) => typeof r.text === "string" && r.text.trim().length > 0,
  );

  const balance: ContextSentimentBalance = {
    positive: 0,
    negative: 0,
    neutral: 0,
    unknown: 0,
  };
  const posts: ContextPostSample[] = [];

  for (const r of rows) {
    const sentiment = pickSentimentLabel(r.post_ai_classifications ?? []);
    bumpBalance(balance, sentiment);

    if (posts.length < POSTS_SAMPLE_LIMIT) {
      posts.push({
        text: (r.text as string).trim(),
        network: r.network,
        language: r.lang,
        sentiment,
        engagement:
          (r.likes ?? 0) + (r.retweets ?? 0) + (r.replies ?? 0) + (r.quotes ?? 0),
      });
    }
  }

  return { posts, sentimentBalance: balance };
}

function pickSentimentLabel(
  rows: { label: string | null; score: number | null }[],
): ContextPostSample["sentiment"] {
  const sentimentRows = rows.filter(
    (r) =>
      r.label === "positive" || r.label === "negative" || r.label === "neutral",
  );
  if (sentimentRows.length === 0) return null;
  const top = [...sentimentRows].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
  return (top.label as ContextPostSample["sentiment"]) ?? null;
}

function bumpBalance(
  balance: ContextSentimentBalance,
  label: ContextPostSample["sentiment"],
): void {
  if (label === "positive") balance.positive += 1;
  else if (label === "negative") balance.negative += 1;
  else if (label === "neutral") balance.neutral += 1;
  else balance.unknown += 1;
}

interface RawEntityRow {
  value: string | null;
  type: string | null;
  occurrence_count: number | null;
}

async function fetchTopEntities(
  gorgone: GorgoneClient,
  zoneId: string,
  since: string,
): Promise<ContextEntity[]> {
  // `entities` keeps per-(zone, entity) running totals via
  // `occurrence_count` and `last_seen_at`. We filter on
  // `last_seen_at >= since` so a long-stale entity (e.g. seen once 6
  // months ago) doesn't dominate the cheatsheet. The DB does the
  // ordering — no client-side aggregation needed.
  const { data } = await gorgone
    .from("entities")
    .select("value, type, occurrence_count")
    .eq("zone_id", zoneId)
    .is("deleted_at", null)
    .gte("last_seen_at", since)
    .order("occurrence_count", { ascending: false })
    .limit(ENTITIES_LIMIT);

  return ((data ?? []) as RawEntityRow[])
    .filter((r): r is RawEntityRow & { value: string } => Boolean(r.value))
    .map((r) => ({
      name: r.value,
      kind: r.type ?? "OTHER",
      occurrences: r.occurrence_count ?? 0,
    }));
}
