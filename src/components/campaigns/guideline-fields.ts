import { BookOpen, MessageSquare, Target, type LucideIcon } from "lucide-react";

/**
 * Single source of truth for the THREE campaign guideline fields:
 * label, helper copy, placeholder, icon, and the column key on
 * `campaigns`. Consumed by:
 *   - `components/campaigns/steps/step-guidelines.tsx` — wizard step
 *   - `components/automator/campaign-center-panel.tsx` — Automator
 *     detail panel (Tabs)
 *   - `components/campaigns/guideline-preview-dialog.tsx` — AI preview
 *
 * Adding/removing a field here automatically propagates everywhere.
 * Copy edits stay in one place — no drift between the wizard and the
 * Automator panel.
 *
 * The order matters — both the wizard and the dialog render the
 * fields top-to-bottom in this order.
 */

export interface GuidelineFieldDefinition {
  /** Column on `campaigns` and key on `GuidelineSuggestion`. */
  key: "operational_context" | "strategy" | "key_messages";
  /** Slug used for the Tabs `value` and the input `id`. */
  slug: "context" | "strategy" | "messages";
  label: string;
  icon: LucideIcon;
  placeholder: string;
  /** Helper text shown below the field in the wizard. */
  helper: string;
}

export const GUIDELINE_FIELDS: readonly GuidelineFieldDefinition[] = [
  {
    key: "operational_context",
    slug: "context",
    label: "Operational Context",
    icon: BookOpen,
    placeholder:
      "Describe the situation, background, and what the AI needs to know...",
    helper:
      "Background information the AI will use to understand the campaign context",
  },
  {
    key: "strategy",
    slug: "strategy",
    label: "Strategy",
    icon: Target,
    placeholder:
      "Define the objectives and behavioral rules for avatars...",
    helper:
      "Objectives, tone directives, and behavioral constraints for avatar responses",
  },
  {
    key: "key_messages",
    slug: "messages",
    label: "Key Messages",
    icon: MessageSquare,
    placeholder:
      "Specific phrases, hashtags, or terminology to use or avoid...",
    helper:
      "Hashtags to push, terms to avoid, specific talking points or vocabulary",
  },
] as const;

export type GuidelineFieldKey = GuidelineFieldDefinition["key"];
