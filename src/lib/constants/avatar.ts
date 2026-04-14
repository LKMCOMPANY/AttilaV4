import type {
  SocialPlatform,
  AvatarStatus,
  WritingStyle,
  Tone,
  VocabularyLevel,
  EmojiUsage,
} from "@/types";

// ---------------------------------------------------------------------------
// Social Platforms
// ---------------------------------------------------------------------------

export interface PlatformConfig {
  id: SocialPlatform;
  label: string;
  abbr: string;
  enabledKey: `${SocialPlatform}_enabled`;
  credKey: `${SocialPlatform}_credentials`;
  color: string;
  bgColor: string;
}

export const PLATFORM_LIST: PlatformConfig[] = [
  { id: "twitter", label: "X (Twitter)", abbr: "X", enabledKey: "twitter_enabled", credKey: "twitter_credentials", color: "text-[#1DA1F2]", bgColor: "bg-[#1DA1F2]/15" },
  { id: "tiktok", label: "TikTok", abbr: "TT", enabledKey: "tiktok_enabled", credKey: "tiktok_credentials", color: "text-foreground", bgColor: "bg-foreground/10" },
  { id: "reddit", label: "Reddit", abbr: "R", enabledKey: "reddit_enabled", credKey: "reddit_credentials", color: "text-[#FF5700]", bgColor: "bg-[#FF5700]/15" },
  { id: "instagram", label: "Instagram", abbr: "IG", enabledKey: "instagram_enabled", credKey: "instagram_credentials", color: "text-[#E4405F]", bgColor: "bg-[#E4405F]/15" },
];

// ---------------------------------------------------------------------------
// Avatar Status
// ---------------------------------------------------------------------------

export const STATUS_CONFIG: Record<AvatarStatus, { color: string; dot: string; label: string }> = {
  active: { color: "bg-success/10 text-success", dot: "bg-success", label: "Active" },
  inactive: { color: "bg-muted text-muted-foreground", dot: "bg-muted-foreground", label: "Inactive" },
  suspended: { color: "bg-destructive/10 text-destructive", dot: "bg-destructive", label: "Suspended" },
};

// ---------------------------------------------------------------------------
// Personality Labels
// ---------------------------------------------------------------------------

export const STYLE_LABELS: Record<WritingStyle, string> = {
  casual: "Casual", formal: "Formal", journalistic: "Journalistic",
  provocative: "Provocative", diplomatic: "Diplomatic",
};

export const TONE_LABELS: Record<Tone, string> = {
  neutral: "Neutral", humorous: "Humorous", serious: "Serious",
  sarcastic: "Sarcastic", empathetic: "Empathetic", aggressive: "Aggressive",
};

export const VOCABULARY_LABELS: Record<VocabularyLevel, string> = {
  simple: "Simple", standard: "Standard", advanced: "Advanced", technical: "Technical",
};

export const EMOJI_LABELS: Record<EmojiUsage, string> = {
  none: "None", sparse: "Sparse", moderate: "Moderate", frequent: "Frequent",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function toOptions<T extends string>(
  values: readonly T[],
  labels?: Record<T, string>
): { value: T; label: string }[] {
  return values.map((v) => ({
    value: v,
    label: labels?.[v] ?? v.charAt(0).toUpperCase() + v.slice(1),
  }));
}
