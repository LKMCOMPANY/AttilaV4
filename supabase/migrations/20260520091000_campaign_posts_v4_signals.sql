-- ============================================================================
-- Attila V4 — Surface Gorgone V4 enrichments on campaign_posts
-- ============================================================================
-- The Gorgone V4 ingestion path collects three pre-computed signals along
-- with every post:
--   * sentiment classification (label + confidence score)
--   * translation into the account locale
--   * the original `posts.posted_at` (when the post was published upstream,
--     distinct from `campaign_posts.created_at` which is the moment Attila
--     processed it through the pipeline)
--
-- These signals were already plumbed end-to-end via `fetchFullGorgonePost`
-- and exposed on `PipelinePost`. This migration materialises them as
-- first-class columns on `campaign_posts` (typed + indexed) so the UI can
-- display them and so future filters / analytics queries can hit indexes
-- instead of jsonb scans.
--
-- Columns are nullable: a post processed before the V4 cutover (or one
-- whose AI sidecars hadn't landed in Gorgone at fetch time) keeps a
-- clean NULL rather than a fabricated default.
-- ============================================================================

alter table public.campaign_posts
  add column if not exists sentiment_label text,
  add column if not exists sentiment_score numeric(3, 2),
  add column if not exists translation_text text,
  add column if not exists translation_lang text,
  add column if not exists source_posted_at timestamptz;

-- Sentiment label — restricted to the three values Gorgone emits.
alter table public.campaign_posts
  drop constraint if exists campaign_posts_sentiment_label_check;
alter table public.campaign_posts
  add constraint campaign_posts_sentiment_label_check
  check (
    sentiment_label is null
    or sentiment_label in ('positive', 'negative', 'neutral')
  );

-- Sentiment score — confidence in [0, 1].
alter table public.campaign_posts
  drop constraint if exists campaign_posts_sentiment_score_check;
alter table public.campaign_posts
  add constraint campaign_posts_sentiment_score_check
  check (
    sentiment_score is null
    or (sentiment_score >= 0 and sentiment_score <= 1)
  );

-- Partial index — supports "show me negative posts in this campaign" type
-- queries without bloating the main index. Excludes the (large) tail of
-- rows where sentiment is unknown.
create index if not exists campaign_posts_sentiment_idx
  on public.campaign_posts (campaign_id, sentiment_label, processed_at desc)
  where sentiment_label is not null;

-- Index for source-posted recency filters (e.g. "responded posts < 24h
-- old at the time of post"). Partial on rows that carry the value.
create index if not exists campaign_posts_source_posted_at_idx
  on public.campaign_posts (campaign_id, source_posted_at desc)
  where source_posted_at is not null;

comment on column public.campaign_posts.sentiment_label is
  'Top sentiment label from Gorgone V4 post_ai_classifications (null when AI had not landed yet at fetch time).';
comment on column public.campaign_posts.sentiment_score is
  'Confidence score 0..1 of sentiment_label.';
comment on column public.campaign_posts.translation_text is
  'Translation of post_text into the Gorgone account locale, if Gorgone produced one.';
comment on column public.campaign_posts.translation_lang is
  'Target language of translation_text (matches Gorgone accounts.locale).';
comment on column public.campaign_posts.source_posted_at is
  'Original posts.posted_at from Gorgone — when the upstream post was published. Distinct from created_at (= Attila ingest time).';
