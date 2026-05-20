"use client";

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Loader2, Sparkles } from "lucide-react";
import {
  GuidelinePreviewDialog,
  type GuidelineTriple,
} from "../guideline-preview-dialog";
import { useGuidelineGeneration } from "../use-guideline-generation";
import { GUIDELINE_FIELDS } from "../guideline-fields";
import type { StepProps } from "../types";

export function StepGuidelines({ data, onChange, accountId }: StepProps) {
  const generation = useGuidelineGeneration();

  // The wizard is operating on a not-yet-saved draft — generation has
  // to be wired in `draft` mode. The button is gated on the prerequisite
  // fields the LLM needs (zone + at least one platform).
  const canGenerate =
    Boolean(data.gorgone_zone_id) && data.platforms.length > 0;

  const handleGenerate = () => {
    if (!canGenerate) return;
    generation.start({
      mode: "draft",
      accountId,
      name: data.name.trim() || "(unnamed campaign)",
      platforms: data.platforms,
      gorgoneZoneId: data.gorgone_zone_id,
    });
  };

  const handleApply = (triple: GuidelineTriple) => {
    onChange(triple);
  };

  return (
    <div className="space-y-5 px-1">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-sm font-medium">Campaign Guidelines</p>
          <p className="text-xs text-muted-foreground">
            Define the context and strategy for AI responses
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleGenerate}
          disabled={!canGenerate || generation.isGenerating}
          className="shrink-0"
          title={
            !canGenerate
              ? "Select a zone and at least one platform first"
              : "Generate guidelines from the zone’s recent activity"
          }
        >
          {generation.isGenerating ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          {generation.isGenerating ? "Generating…" : "Generate with AI"}
        </Button>
      </div>

      {GUIDELINE_FIELDS.map((field) => {
        const Icon = field.icon;
        const inputId = `wizard-${field.slug}`;
        return (
          <div key={field.key} className="space-y-2">
            <div className="flex items-center gap-2">
              <Icon className="h-4 w-4 text-muted-foreground" />
              <Label htmlFor={inputId}>{field.label}</Label>
            </div>
            <Textarea
              id={inputId}
              placeholder={field.placeholder}
              value={data[field.key]}
              onChange={(e) => onChange({ [field.key]: e.target.value })}
              rows={4}
              className="resize-none"
            />
            <p className="text-[11px] text-muted-foreground">{field.helper}</p>
          </div>
        );
      })}

      <GuidelinePreviewDialog
        open={generation.isDialogOpen}
        onOpenChange={generation.setDialogOpen}
        loading={generation.isGenerating}
        result={generation.result}
        error={generation.error}
        onApply={handleApply}
      />
    </div>
  );
}
