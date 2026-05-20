import { DISARM_TOP_15_BLOCK } from "./disarm-doctrine";
import type {
  GuidelineContext,
  GuidelineLocale,
} from "@/lib/ai/guideline-types";

/**
 * Pure builders for the campaign-guideline generation prompt.
 *
 * Intentionally side-effect-free: zero I/O, zero LLM calls, zero
 * Supabase access. Takes a fully-resolved `GuidelineContext` and
 * returns string blocks. Consumers feed those into the Aleria
 * `generateText` call. Easy to unit-test with golden snapshots,
 * easy to swap the LLM provider later.
 */

/**
 * Bumped whenever ANY part of the system or user prompt changes
 * (instructions, schema, doctrine inclusion, sample-size policy).
 * Logged into `pipelineLog` so a future audit can correlate output
 * quality with prompt evolution.
 *
 * v2 (2026-05-20): hardened the OUTPUT FORMAT block with an explicit
 * "STRING, NOT ARRAY" warning + a worked example after Aleria
 * regressed `key_messages` into `["…", "…"]` form on its first
 * production run. The schema still tolerates arrays defensively.
 */
export const GUIDELINE_PROMPT_VERSION = "guideline-v2";

const LOCALE_NAMES: Record<GuidelineLocale, string> = {
  en: "English",
  fr: "French",
  es: "Spanish",
  ar: "Arabic",
};

/**
 * Caps applied during prompt assembly so a malicious / malformed
 * `zone.description` or post can't blow the context window.
 */
const ZONE_DESCRIPTION_MAX_CHARS = 1000;
const POST_TEXT_MAX_CHARS = 280;
// Aligned with `POSTS_SAMPLE_LIMIT` / `ENTITIES_LIMIT` in
// `guideline-context.ts`. We keep the prompt rich because Aleria
// runs on our own infra — quality wins over token cost.
const POSTS_IN_PROMPT_MAX = 60;
const ENTITIES_IN_PROMPT_MAX = 25;

/**
 * Strip control chars + delimiters that conflict with our prompt
 * separators (we use ═══ — defensive sanitization in case a Gorgone
 * operator copy-pasted strange content).
 */
function sanitize(input: string): string {
  return input
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/═/g, "=")
    .replace(/\s+/g, " ")
    .trim();
}

function clip(input: string, max: number): string {
  if (input.length <= max) return input;
  return `${input.slice(0, max - 1).trimEnd()}…`;
}

// ---------------------------------------------------------------------------
// System prompt — instructions + doctrine
// ---------------------------------------------------------------------------

export function buildGuidelineSystemPrompt(locale: GuidelineLocale): string {
  const language = LOCALE_NAMES[locale];

  return [
    `═══ ROLE ═══`,
    `You are a senior strategic advisor to a government information operations`,
    `cell. Your task is to draft three guideline blocks that will steer a fleet`,
    `of social-media avatars responding to posts inside a monitoring zone.`,
    ``,
    `The avatars will receive these guidelines verbatim alongside an analyst`,
    `prompt. Quality and precision matter — a vague brief produces vague`,
    `responses; a sharp brief produces credible, situated, on-message replies.`,
    ``,
    `═══ OUTPUT FORMAT ═══`,
    `Respond with a STRICT JSON object — no commentary, no markdown fence — `,
    `with exactly these three keys, EACH VALUE MUST BE A SINGLE STRING.`,
    `DO NOT return arrays, DO NOT return nested objects, DO NOT split`,
    `bullets into separate items — write the bullets INSIDE the string,`,
    `one per newline.`,
    ``,
    `  operational_context  (string) Background. The situation, the actors,`,
    `                       the threat narratives, what the avatars need to`,
    `                       understand before reading any post. 200-600 words.`,
    ``,
    `  strategy             (string) Objectives + behavioural constraints.`,
    `                       What the campaign aims to achieve, the tone to`,
    `                       project, what avatars MUST and MUST NOT do.`,
    `                       200-500 words.`,
    ``,
    `  key_messages         (string) Talking points + vocabulary. Specific`,
    `                       phrases, hashtags to push, terms to avoid,`,
    `                       framings to favour. Newline-separated bullets`,
    `                       inside ONE string. 100-400 words.`,
    ``,
    `EXAMPLE of the EXACT shape expected (truncated content):`,
    `{`,
    `  "operational_context": "The zone covers ... narrative actors ...",`,
    `  "strategy": "Objective: counter T0049 flooding bursts ...",`,
    `  "key_messages": "• Hashtags to push: #PeaceForUAE\\n• Avoid: ..."`,
    `}`,
    ``,
    `═══ LANGUAGE ═══`,
    `Write all three fields in ${language}. Do NOT translate proper nouns,`,
    `hashtags, or DISARM technique ids — they stay verbatim.`,
    ``,
    `═══ QUALITY RULES ═══`,
    `- Anchor every claim in the supplied CONTEXT. If the data does not support`,
    `  a claim, do not make it.`,
    `- Be specific: cite actors by name, networks by name, sentiment direction.`,
    `- Be neutral: produce briefs a competent civil servant could read without`,
    `  embarrassment. No partisan editorialising, no slurs.`,
    `- When you reference an adversarial pattern listed in the doctrine, tag`,
    `  it with the canonical id ("[T0049] flooding pattern").`,
    `- Never invent DISARM ids. If unsure, describe in plain prose.`,
    ``,
    DISARM_TOP_15_BLOCK,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// User prompt — context for THIS zone
// ---------------------------------------------------------------------------

export function buildGuidelineUserPrompt(ctx: GuidelineContext): string {
  const lines: string[] = [];

  lines.push(`═══ CAMPAIGN ═══`);
  lines.push(`Name: ${sanitize(ctx.campaign.name)}`);
  lines.push(`Platforms (avatars): ${ctx.campaign.platforms.join(", ") || "(none)"}`);
  lines.push("");

  lines.push(`═══ ZONE ═══`);
  lines.push(`Name: ${sanitize(ctx.zone.name)}`);
  if (ctx.zone.description) {
    lines.push(`Brief: ${clip(sanitize(ctx.zone.description), ZONE_DESCRIPTION_MAX_CHARS)}`);
  } else {
    lines.push(`Brief: (none provided)`);
  }
  lines.push("");

  // Sentiment balance — quick win for the model to frame strategy
  const sb = ctx.sentimentBalance;
  const total = sb.positive + sb.negative + sb.neutral + sb.unknown;
  if (total > 0) {
    const pct = (n: number) => (total === 0 ? 0 : Math.round((n / total) * 100));
    lines.push(`═══ SENTIMENT BALANCE (last ${ctx.windowHours}h) ═══`);
    lines.push(
      `positive ${sb.positive} (${pct(sb.positive)}%)  /  negative ${sb.negative} (${pct(sb.negative)}%)  /  neutral ${sb.neutral} (${pct(sb.neutral)}%)  /  unknown ${sb.unknown}`,
    );
    lines.push("");
  }

  if (ctx.topEntities.length > 0) {
    lines.push(`═══ TOP ENTITIES IN ZONE ═══`);
    for (const e of ctx.topEntities.slice(0, ENTITIES_IN_PROMPT_MAX)) {
      lines.push(`- ${sanitize(e.name)} (${e.kind}) — ${e.occurrences} occurrences`);
    }
    lines.push("");
  }

  if (ctx.posts.length > 0) {
    lines.push(`═══ REPRESENTATIVE POSTS (${Math.min(ctx.posts.length, POSTS_IN_PROMPT_MAX)} of ${ctx.postsSampled}) ═══`);
    for (const p of ctx.posts.slice(0, POSTS_IN_PROMPT_MAX)) {
      const lang = p.language ?? "?";
      const sent = p.sentiment ?? "?";
      const text = clip(sanitize(p.text), POST_TEXT_MAX_CHARS);
      lines.push(`[${p.network} · ${lang} · ${sent} · eng:${p.engagement}] ${text}`);
    }
    lines.push("");
  } else {
    lines.push(`═══ POSTS ═══`);
    lines.push(`(no posts collected in zone yet — generate guidelines from the brief alone)`);
    lines.push("");
  }

  lines.push(`═══ TASK ═══`);
  lines.push(
    `Write the three guideline blocks (operational_context, strategy, key_messages) in JSON.`,
  );
  return lines.join("\n");
}

// Caps re-exported so the generator can size its sample to the same
// budget the prompt builder actually uses.
export const GUIDELINE_PROMPT_LIMITS = {
  postsInPromptMax: POSTS_IN_PROMPT_MAX,
  entitiesInPromptMax: ENTITIES_IN_PROMPT_MAX,
} as const;
