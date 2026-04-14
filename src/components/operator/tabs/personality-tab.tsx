"use client";

import { useState, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis } from "recharts";
import { toast } from "sonner";
import {
  STYLE_LABELS,
  TONE_LABELS,
  VOCABULARY_LABELS,
  EMOJI_LABELS,
  toOptions,
} from "@/lib/constants/avatar";
import { updateAvatar } from "@/app/actions/avatars";
import type { AvatarWithRelations, WritingStyle, Tone, VocabularyLevel, EmojiUsage } from "@/types";
import { WRITING_STYLES, TONES, VOCABULARY_LEVELS, EMOJI_USAGES } from "@/types";
import type { EditableTabProps } from "../avatar-detail-panel";
import { Pen, Volume2, BookOpen, Smile, Lightbulb, BrainCircuit, ShieldAlert, Plus, X } from "lucide-react";

const STYLE_OPTIONS = toOptions(WRITING_STYLES, STYLE_LABELS);
const TONE_OPTIONS = toOptions(TONES, TONE_LABELS);
const VOCAB_OPTIONS = toOptions(VOCABULARY_LEVELS, VOCABULARY_LABELS);
const EMOJI_OPTIONS = toOptions(EMOJI_USAGES, EMOJI_LABELS);

function normalizeIndex(value: string, list: readonly string[]): number {
  const idx = list.indexOf(value);
  if (idx === -1) return 0;
  return Math.round(((idx + 1) / list.length) * 100);
}

const chartConfig = {
  personality: { label: "Personality", color: "var(--primary)" },
} satisfies ChartConfig;

export function PersonalityTab({ avatar, onUpdated }: EditableTabProps) {
  const saveField = async (field: string, value: unknown) => {
    const prev = avatar[field as keyof AvatarWithRelations];
    onUpdated({ ...avatar, [field]: value } as AvatarWithRelations);

    const { error } = await updateAvatar(avatar.id, { [field]: value });
    if (error) {
      toast.error(error);
      onUpdated({ ...avatar, [field]: prev } as AvatarWithRelations);
    }
  };

  const radarData = useMemo(
    () => [
      { axis: "Writing", value: normalizeIndex(avatar.writing_style, WRITING_STYLES) },
      { axis: "Tone", value: normalizeIndex(avatar.tone, TONES) },
      { axis: "Vocabulary", value: normalizeIndex(avatar.vocabulary_level, VOCABULARY_LEVELS) },
      { axis: "Emoji", value: normalizeIndex(avatar.emoji_usage, EMOJI_USAGES) },
      { axis: "Traits", value: Math.min(avatar.personality_traits.length * 20, 100) },
      { axis: "Expertise", value: Math.min(avatar.topics_expertise.length * 20, 100) },
    ],
    [avatar.writing_style, avatar.tone, avatar.vocabulary_level, avatar.emoji_usage, avatar.personality_traits.length, avatar.topics_expertise.length]
  );

  return (
    <div className="space-y-5">
      {/* Radar chart */}
      <div className="rounded-lg border bg-card/50 p-3">
        <h4 className="mb-2 text-[13px] font-semibold">Personality Profile</h4>
        <ChartContainer config={chartConfig} className="mx-auto aspect-square w-full max-w-[280px]">
          <RadarChart data={radarData}>
            <PolarGrid stroke="var(--border)" strokeOpacity={0.5} />
            <PolarAngleAxis dataKey="axis" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
            <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Radar name="personality" dataKey="value" stroke="var(--primary)" fill="var(--primary)" fillOpacity={0.15} strokeWidth={1.5} />
          </RadarChart>
        </ChartContainer>
      </div>

      {/* Editable attributes */}
      <div className="rounded-lg border bg-card/50">
        <SelectRow
          icon={Pen}
          label="Writing Style"
          value={avatar.writing_style}
          options={STYLE_OPTIONS}
          onChange={(v) => saveField("writing_style", v as WritingStyle)}
          first
        />
        <SelectRow
          icon={Volume2}
          label="Tone"
          value={avatar.tone}
          options={TONE_OPTIONS}
          onChange={(v) => saveField("tone", v as Tone)}
        />
        <SelectRow
          icon={BookOpen}
          label="Vocabulary"
          value={avatar.vocabulary_level}
          options={VOCAB_OPTIONS}
          onChange={(v) => saveField("vocabulary_level", v as VocabularyLevel)}
        />
        <SelectRow
          icon={Smile}
          label="Emoji Usage"
          value={avatar.emoji_usage}
          options={EMOJI_OPTIONS}
          onChange={(v) => saveField("emoji_usage", v as EmojiUsage)}
          last
        />
      </div>

      {/* Editable tag sections */}
      <EditableTagSection
        icon={BrainCircuit}
        title="Personality Traits"
        items={avatar.personality_traits}
        placeholder="e.g., curious, witty..."
        onSave={(items) => saveField("personality_traits", items)}
      />
      <EditableTagSection
        icon={Lightbulb}
        title="Topics of Expertise"
        items={avatar.topics_expertise}
        placeholder="e.g., tech, sports..."
        onSave={(items) => saveField("topics_expertise", items)}
      />
      <EditableTagSection
        icon={ShieldAlert}
        title="Topics to Avoid"
        items={avatar.topics_avoid}
        placeholder="e.g., politics..."
        variant="destructive"
        onSave={(items) => saveField("topics_avoid", items)}
      />
    </div>
  );
}

function SelectRow({
  icon: Icon,
  label,
  value,
  options,
  onChange,
  first,
  last,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  first?: boolean;
  last?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-3 px-3 py-2.5 ${
        !last ? "border-b border-border/40" : ""
      } ${first ? "rounded-t-lg" : ""} ${last ? "rounded-b-lg" : ""}`}
    >
      <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
        <Icon className="h-3.5 w-3.5 shrink-0 opacity-50" />
        <span>{label}</span>
      </div>
      <Select value={value} onValueChange={(v) => { if (v) onChange(v); }}>
        <SelectTrigger className="h-6 w-auto gap-1 border-0 bg-transparent px-1.5 text-[11px] font-medium capitalize shadow-none">
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

function EditableTagSection({
  icon: Icon,
  title,
  items,
  placeholder,
  variant = "outline",
  onSave,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  items: string[];
  placeholder: string;
  variant?: "outline" | "destructive";
  onSave: (items: string[]) => void;
}) {
  const [input, setInput] = useState("");

  const addItem = () => {
    const trimmed = input.trim().toLowerCase();
    if (!trimmed || items.includes(trimmed)) return;
    onSave([...items, trimmed]);
    setInput("");
  };

  const removeItem = (item: string) => {
    onSave(items.filter((i) => i !== item));
  };

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-muted-foreground/60" />
        <h4 className="text-[13px] font-semibold">{title}</h4>
      </div>
      {items.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {items.map((item) => (
            <Badge key={item} variant={variant} className="gap-1 pr-1 text-[11px]">
              {item}
              <button
                onClick={() => removeItem(item)}
                className="rounded-full p-0.5 hover:bg-muted-foreground/20"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </Badge>
          ))}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed bg-muted/20 px-3 py-2.5 text-[12px] text-muted-foreground/70">
          None added
        </p>
      )}
      <div className="mt-2 flex gap-1.5">
        <Input
          placeholder={placeholder}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addItem(); } }}
          className="h-7 text-[11px]"
          autoComplete="off"
        />
        <Button variant="outline" size="sm" onClick={addItem} disabled={!input.trim()} className="h-7 w-7 shrink-0 p-0">
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
