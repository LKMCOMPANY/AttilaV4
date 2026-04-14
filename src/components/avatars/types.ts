import type {
  SocialCredentials,
  WritingStyle,
  Tone,
  VocabularyLevel,
  EmojiUsage,
} from "@/types";

export interface AvatarFormData {
  // Step 1
  country_code: string;
  language_code: string;

  // Step 2
  first_name: string;
  last_name: string;
  profile_image_url: string;
  email: string;
  phone: string;

  // Step 3
  writing_style: WritingStyle;
  tone: Tone;
  vocabulary_level: VocabularyLevel;
  emoji_usage: EmojiUsage;
  personality_traits: string[];
  topics_expertise: string[];
  topics_avoid: string[];

  // Step 4
  device_id: string | null;

  // Step 5
  twitter_enabled: boolean;
  tiktok_enabled: boolean;
  reddit_enabled: boolean;
  instagram_enabled: boolean;
  twitter_credentials: SocialCredentials;
  tiktok_credentials: SocialCredentials;
  reddit_credentials: SocialCredentials;
  instagram_credentials: SocialCredentials;

  // Step 6
  operator_ids: string[];
  army_ids: string[];
  new_army_names: string[];
}

export const DEFAULT_FORM_DATA: AvatarFormData = {
  country_code: "",
  language_code: "",
  first_name: "",
  last_name: "",
  profile_image_url: "",
  email: "",
  phone: "",
  writing_style: "casual",
  tone: "neutral",
  vocabulary_level: "standard",
  emoji_usage: "sparse",
  personality_traits: [],
  topics_expertise: [],
  topics_avoid: [],
  device_id: null,
  twitter_enabled: false,
  tiktok_enabled: false,
  reddit_enabled: false,
  instagram_enabled: false,
  twitter_credentials: {},
  tiktok_credentials: {},
  reddit_credentials: {},
  instagram_credentials: {},
  operator_ids: [],
  army_ids: [],
  new_army_names: [],
};

export interface StepProps {
  data: AvatarFormData;
  onChange: (patch: Partial<AvatarFormData>) => void;
}

export const STEPS = [
  { id: "country", label: "Country" },
  { id: "identity", label: "Identity" },
  { id: "personality", label: "Personality" },
  { id: "device", label: "Device" },
  { id: "social", label: "Social Media" },
  { id: "attribution", label: "Attribution" },
] as const;
