"use client";

import { useMemo, useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, X, Sparkles } from "lucide-react";
import { PolarAngleAxis, PolarGrid, Radar, RadarChart } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  WRITING_STYLES,
  TONES,
  VOCABULARY_LEVELS,
  EMOJI_USAGES,
} from "@/types";
import type { WritingStyle, Tone, VocabularyLevel, EmojiUsage } from "@/types";
import { toOptions } from "@/lib/constants/avatar";
import type { StepProps } from "../types";

const STYLE_OPTIONS = toOptions(WRITING_STYLES);
const TONE_OPTIONS = toOptions(TONES);
const VOCAB_OPTIONS = toOptions(VOCABULARY_LEVELS);
const EMOJI_OPTIONS = toOptions(EMOJI_USAGES);

const chartConfig = {
  value: { label: "Level", color: "var(--chart-1)" },
} satisfies ChartConfig;

const STYLE_SCORES: Record<string, number> = {
  casual: 30, formal: 70, provocative: 90, diplomatic: 50, journalistic: 60,
};
const TONE_SCORES: Record<string, number> = {
  neutral: 40, humorous: 60, serious: 70, sarcastic: 80, empathetic: 50, aggressive: 95,
};
const VOCAB_SCORES: Record<string, number> = {
  simple: 25, standard: 50, advanced: 75, technical: 90,
};
const EMOJI_SCORES: Record<string, number> = {
  none: 10, sparse: 30, moderate: 60, frequent: 90,
};

export function StepPersonality({ data, onChange }: StepProps) {
  const [traitInput, setTraitInput] = useState("");
  const [expertiseInput, setExpertiseInput] = useState("");
  const [avoidInput, setAvoidInput] = useState("");

  const chartData = useMemo(
    () => [
      { trait: "Style", value: STYLE_SCORES[data.writing_style] ?? 50 },
      { trait: "Tone", value: TONE_SCORES[data.tone] ?? 50 },
      { trait: "Vocabulary", value: VOCAB_SCORES[data.vocabulary_level] ?? 50 },
      { trait: "Emoji", value: EMOJI_SCORES[data.emoji_usage] ?? 50 },
      { trait: "Expertise", value: Math.min(data.topics_expertise.length * 25, 100) },
      { trait: "Personality", value: Math.min(data.personality_traits.length * 25, 100) },
    ],
    [data.writing_style, data.tone, data.vocabulary_level, data.emoji_usage, data.topics_expertise.length, data.personality_traits.length]
  );

  const addTag = (
    field: "personality_traits" | "topics_expertise" | "topics_avoid",
    value: string,
    setter: (v: string) => void
  ) => {
    const trimmed = value.trim().toLowerCase();
    if (!trimmed || data[field].includes(trimmed)) return;
    onChange({ [field]: [...data[field], trimmed] });
    setter("");
  };

  const removeTag = (
    field: "personality_traits" | "topics_expertise" | "topics_avoid",
    tag: string
  ) => {
    onChange({ [field]: data[field].filter((t) => t !== tag) });
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h3 className="text-heading-3">Personality</h3>
        <p className="text-body-sm text-muted-foreground">
          Define the writing style, traits, and expertise for this avatar.
        </p>
      </div>

      {/* Writing style selects + Radar */}
      <div className="grid gap-6 md:grid-cols-2">
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-1 lg:grid-cols-2">
          <SelectField
            label="Tone"
            value={data.tone}
            options={TONE_OPTIONS}
            onChange={(v) => onChange({ tone: v as Tone })}
          />
          <SelectField
            label="Style"
            value={data.writing_style}
            options={STYLE_OPTIONS}
            onChange={(v) => onChange({ writing_style: v as WritingStyle })}
          />
          <SelectField
            label="Vocabulary"
            value={data.vocabulary_level}
            options={VOCAB_OPTIONS}
            onChange={(v) => onChange({ vocabulary_level: v as VocabularyLevel })}
          />
          <SelectField
            label="Emoji Usage"
            value={data.emoji_usage}
            options={EMOJI_OPTIONS}
            onChange={(v) => onChange({ emoji_usage: v as EmojiUsage })}
          />
        </div>

        <div className="flex flex-col items-center justify-center rounded-lg border bg-muted/30 p-4">
          <span className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Personality Profile
          </span>
          <ChartContainer config={chartConfig} className="mx-auto aspect-square w-full max-w-[240px]">
            <RadarChart data={chartData}>
              <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
              <PolarAngleAxis
                dataKey="trait"
                tick={{ fontSize: 10, fill: "var(--color-value)", fontWeight: 500 }}
                tickLine={false}
              />
              <PolarGrid className="stroke-muted-foreground/20" />
              <Radar
                dataKey="value"
                fill="var(--color-value)"
                fillOpacity={0.35}
                stroke="var(--color-value)"
                strokeWidth={2}
                dot={{ r: 3, fill: "var(--color-value)", fillOpacity: 1 }}
              />
            </RadarChart>
          </ChartContainer>
        </div>
      </div>

      {/* Tags */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <Label className="text-label">Personality & Expertise</Label>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <TagField
            label="Personality Traits"
            tags={data.personality_traits}
            inputValue={traitInput}
            onInputChange={setTraitInput}
            onAdd={() => addTag("personality_traits", traitInput, setTraitInput)}
            onRemove={(t) => removeTag("personality_traits", t)}
            placeholder="e.g., curious, witty..."
            variant="secondary"
          />
          <TagField
            label="Topics Expertise"
            tags={data.topics_expertise}
            inputValue={expertiseInput}
            onInputChange={setExpertiseInput}
            onAdd={() => addTag("topics_expertise", expertiseInput, setExpertiseInput)}
            onRemove={(t) => removeTag("topics_expertise", t)}
            placeholder="e.g., tech, sports..."
            variant="primary"
          />
          <TagField
            label="Topics to Avoid"
            tags={data.topics_avoid}
            inputValue={avoidInput}
            onInputChange={setAvoidInput}
            onAdd={() => addTag("topics_avoid", avoidInput, setAvoidInput)}
            onRemove={(t) => removeTag("topics_avoid", t)}
            placeholder="e.g., politics..."
            variant="destructive"
          />
        </div>
      </div>
    </div>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-label">{label}</Label>
      <Select value={value} onValueChange={(v) => { if (v) onChange(v); }}>
        <SelectTrigger className="h-9">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

const TAG_STYLES = {
  secondary: {
    border: "border-dashed",
    badge: "secondary" as const,
    removeHover: "hover:bg-muted-foreground/20",
  },
  primary: {
    border: "border-dashed border-primary/30",
    badge: "outline" as const,
    removeHover: "hover:bg-primary/20",
  },
  destructive: {
    border: "border-dashed border-destructive/30",
    badge: "outline" as const,
    removeHover: "hover:bg-destructive/20",
  },
};

function TagField({
  label,
  tags,
  inputValue,
  onInputChange,
  onAdd,
  onRemove,
  placeholder,
  variant,
}: {
  label: string;
  tags: string[];
  inputValue: string;
  onInputChange: (v: string) => void;
  onAdd: () => void;
  onRemove: (tag: string) => void;
  placeholder: string;
  variant: keyof typeof TAG_STYLES;
}) {
  const s = TAG_STYLES[variant];
  return (
    <div className="space-y-2">
      <Label className="text-label">{label}</Label>
      <div className={`flex min-h-[52px] flex-wrap gap-1.5 rounded-lg border p-2 ${s.border}`}>
        {tags.length === 0 ? (
          <span className="self-center text-xs text-muted-foreground">None added</span>
        ) : (
          tags.map((tag) => (
            <Badge key={tag} variant={s.badge} className="h-6 gap-1 pr-1">
              {tag}
              <button
                type="button"
                onClick={() => onRemove(tag)}
                className={`ml-0.5 rounded-full p-0.5 ${s.removeHover}`}
                aria-label={`Remove ${tag}`}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))
        )}
      </div>
      <div className="flex gap-1.5">
        <Input
          placeholder={placeholder}
          value={inputValue}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onAdd();
            }
          }}
          className="h-8 text-sm"
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onAdd}
          disabled={!inputValue.trim()}
          className="h-8 w-8 shrink-0 p-0"
          aria-label="Add tag"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
