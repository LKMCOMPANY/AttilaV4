import type { Avatar, CampaignPlatform } from "@/types";
import type { PipelinePost } from "./types";

// ---------------------------------------------------------------------------
// Analyst — decides relevance + avatar count
// ---------------------------------------------------------------------------

export function buildAnalystSystemPrompt(guideline: {
  operational_context: string | null;
  strategy: string | null;
  key_messages: string | null;
}): string {
  const parts: string[] = [
    "You are an AI analyst for a social media campaign. Your job is to evaluate whether a post deserves a coordinated response from our avatars.",
    "",
    "Evaluate based on:",
    "- Relevance to the campaign strategy and key messages",
    "- Engagement potential (viral, trending, influential author)",
    "- Opportunity for meaningful interaction (not spam, not irrelevant)",
    "",
    "Return your decision as JSON with:",
    "- relevant: true/false",
    "- reason: brief explanation (1 sentence)",
    "- suggested_avatar_count: how many avatars should respond (1-5)",
    "",
    "Higher avatar_count for: viral posts, influential authors, high-engagement posts.",
    "Lower avatar_count (1) for: niche posts, smaller accounts, moderate engagement.",
    "0 avatar_count is not valid — if not relevant, set relevant=false.",
  ];

  if (guideline.operational_context) {
    parts.push("", "CAMPAIGN CONTEXT:", guideline.operational_context);
  }
  if (guideline.strategy) {
    parts.push("", "STRATEGY:", guideline.strategy);
  }
  if (guideline.key_messages) {
    parts.push("", "KEY MESSAGES:", guideline.key_messages);
  }

  return parts.join("\n");
}

export function buildAnalystUserPrompt(post: PipelinePost): string {
  const lines: string[] = [
    `Platform: ${post.platform}`,
    `Author: @${post.post_author ?? "unknown"} (${post.author_followers} followers${post.author_verified ? ", verified" : ""})`,
    `Engagement: ${post.total_engagement}`,
    `Language: ${post.language ?? "unknown"}`,
    "",
    "POST:",
    post.post_text,
  ];

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Writer — generates a comment for one avatar
// ---------------------------------------------------------------------------

export function buildWriterSystemPrompt(
  avatar: Avatar,
  platform: CampaignPlatform,
  guideline: {
    operational_context: string | null;
    strategy: string | null;
    key_messages: string | null;
  },
): string {
  const parts: string[] = [];

  parts.push(buildPersonalityBlock(avatar));
  parts.push("");
  parts.push(buildPlatformRules(platform, avatar.language_code));
  parts.push("");
  parts.push(buildAntiDetectionRules());

  if (guideline.operational_context) {
    parts.push("", "CAMPAIGN CONTEXT:", guideline.operational_context);
  }
  if (guideline.strategy) {
    parts.push("", "STRATEGY:", guideline.strategy);
  }
  if (guideline.key_messages) {
    parts.push("", "KEY MESSAGES:", guideline.key_messages);
  }

  parts.push("", "CRITICAL: Reply with ONLY the comment text. No quotes, no explanation, no prefix.");

  return parts.join("\n");
}

export function buildWriterUserPrompt(
  post: PipelinePost,
  previousCommentsOnPost: string[],
  recentAvatarComments: string[],
): string {
  const lines: string[] = [
    `@${post.post_author ?? "unknown"} wrote:`,
    post.post_text,
  ];

  if (previousCommentsOnPost.length > 0) {
    lines.push(
      "",
      "OTHER AVATARS ALREADY COMMENTED ON THIS POST (do NOT repeat their ideas):",
      ...previousCommentsOnPost.map((c, i) => `${i + 1}. ${c}`),
    );
  }

  if (recentAvatarComments.length > 0) {
    lines.push(
      "",
      "YOUR RECENT COMMENTS (vary your style and ideas):",
      ...recentAvatarComments.map((c, i) => `${i + 1}. ${c}`),
    );
  }

  lines.push("", "Write your comment:");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Personality description
// ---------------------------------------------------------------------------

function buildPersonalityBlock(avatar: Avatar): string {
  const name = `${avatar.first_name} ${avatar.last_name}`;
  const lang = getLanguageName(avatar.language_code);

  const lines: string[] = [
    `You are ${name}, a real person on social media.`,
    `You write in ${lang}.`,
    `Writing style: ${avatar.writing_style}`,
    `Tone: ${avatar.tone}`,
    `Vocabulary: ${avatar.vocabulary_level}`,
    `Emoji usage: ${avatar.emoji_usage}`,
  ];

  if (avatar.personality_traits.length > 0) {
    lines.push(`Personality: ${avatar.personality_traits.join(", ")}`);
  }
  if (avatar.topics_expertise.length > 0) {
    lines.push(`Expertise: ${avatar.topics_expertise.join(", ")}`);
  }
  if (avatar.topics_avoid.length > 0) {
    lines.push(`Avoid topics: ${avatar.topics_avoid.join(", ")}`);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Platform-specific rules
// ---------------------------------------------------------------------------

function buildPlatformRules(platform: CampaignPlatform, languageCode: string): string {
  if (platform === "twitter") {
    return [
      "PLATFORM: Twitter/X",
      "- Maximum 280 characters",
      "- Keep it short, punchy, conversational",
      "- No hashtags unless absolutely natural",
      "- You can mention the author with @ if relevant",
      `- Write in ${getLanguageName(languageCode)}`,
    ].join("\n");
  }

  return [
    "PLATFORM: TikTok",
    "- Comments can be longer (up to 500 chars) but shorter is better",
    "- Very casual, energetic, playful tone",
    "- Emojis are more natural on TikTok",
    "- No hashtags in comments",
    `- Write in ${getLanguageName(languageCode)}`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Anti-detection rules
// ---------------------------------------------------------------------------

function buildAntiDetectionRules(): string {
  return [
    "RULES FOR NATURAL WRITING:",
    "- Write like a real human scrolling their feed, not a marketing bot",
    "- NEVER start with: \"Great point!\", \"I completely agree\", \"This is so true\", \"Interesting perspective\"",
    "- NEVER use em dashes (—) or balanced \"on one hand... on the other hand\" structures",
    "- NEVER end with a generic emoji reaction",
    "- Vary your sentence length. Sometimes short. Sometimes a bit longer but still natural.",
    "- Occasional lowercase start is fine",
    "- Skip punctuation sometimes if casual",
    "- You can disagree, ask a question, share an anecdote, or add context",
    "- Sound like you have a REAL opinion, not a diplomatic AI summary",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Post-processing
// ---------------------------------------------------------------------------

const BANNED_OPENINGS = [
  "great point",
  "i completely agree",
  "this is so true",
  "interesting perspective",
  "absolutely agree",
  "well said",
  "couldn't agree more",
  "so true",
  "love this",
  "great take",
];

export function postProcessComment(text: string, platform: CampaignPlatform): string {
  let result = text.trim();

  // Strip markdown wrappers
  result = result.replace(/^```[a-z]*\s*/i, "").replace(/\s*```$/i, "");
  result = result.replace(/^["'«]|["'»]$/g, "");

  // Strip "Here's my response:" style prefixes
  result = result.replace(/^(here'?s?\s+(my|a)\s+(response|reply|comment|take)\s*:?\s*)/i, "");

  // Normalize dashes
  result = result.replace(/[—–]/g, "-");

  // Strip trailing hashtags (greedy: #word at end of string)
  result = result.replace(/(\s+#\w+)+\s*$/, "");

  // Trim to platform limits
  const maxLen = platform === "twitter" ? 280 : 500;
  if (result.length > maxLen) {
    result = truncateNaturally(result, maxLen);
  }

  return result.trim();
}

function truncateNaturally(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;

  const truncated = text.slice(0, maxLen);
  const lastSpace = truncated.lastIndexOf(" ");
  const lastPunctuation = Math.max(
    truncated.lastIndexOf("."),
    truncated.lastIndexOf("!"),
    truncated.lastIndexOf("?"),
  );

  const cutPoint = lastPunctuation > maxLen * 0.6
    ? lastPunctuation + 1
    : lastSpace > maxLen * 0.6
      ? lastSpace
      : maxLen;

  return text.slice(0, cutPoint).trim();
}

export function validateComment(text: string): { valid: boolean; reason?: string } {
  if (!text || text.length < 5) {
    return { valid: false, reason: "too_short" };
  }

  const lower = text.toLowerCase();
  for (const banned of BANNED_OPENINGS) {
    if (lower.startsWith(banned)) {
      return { valid: false, reason: `banned_opening: ${banned}` };
    }
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// Language helpers
// ---------------------------------------------------------------------------

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  fr: "French",
  es: "Spanish",
  de: "German",
  it: "Italian",
  pt: "Portuguese",
  ar: "Arabic",
  ja: "Japanese",
  ko: "Korean",
  zh: "Chinese",
  ru: "Russian",
  tr: "Turkish",
  nl: "Dutch",
  pl: "Polish",
  sv: "Swedish",
};

function getLanguageName(code: string): string {
  return LANGUAGE_NAMES[code] ?? code;
}
