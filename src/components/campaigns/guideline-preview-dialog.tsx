"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, Sparkles } from "lucide-react";
import {
  GUIDELINE_FIELDS,
  type GuidelineFieldDefinition,
} from "./guideline-fields";
import type { GenerateGuidelinesResponse } from "@/app/actions/campaigns";

/**
 * Reusable preview dialog for AI-generated guideline triples.
 *
 * Layout — sticky header & footer, scrollable body. Capped at
 * `max-h-[85vh]` so very long LLM outputs (3 × 4000-char fields)
 * never push the Cancel/Apply buttons off-screen on small viewports.
 *
 * Lifecycle (per-instance, controlled by the parent via `open`):
 *   `open=false`              → dialog closed, no state held
 *   `open=true && loading`    → animated GenerationProgress with
 *                               cycling step labels + elapsed timer
 *   `open=true && !loading`   → 3 editable Textareas pre-filled with
 *                               the LLM output. Operator edits in place
 *                               before clicking Apply.
 *   `error`                   → muted error banner replaces the form
 *
 * Field labels / icons / order all come from `guideline-fields.ts`,
 * the shared source of truth used by the wizard, the Automator panel,
 * and this dialog.
 */

export interface GuidelineTriple {
  operational_context: string;
  strategy: string;
  key_messages: string;
}

interface GuidelinePreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** True while the parent's `generateCampaignGuidelines` is in flight. */
  loading: boolean;
  /** Set when the LLM returned a result — null while loading or after a reset. */
  result: GenerateGuidelinesResponse | null;
  /** Set when the parent's call rejected. Mutually exclusive with `result`. */
  error: string | null;
  /** Called when the operator clicks Apply with the (possibly edited) triple. */
  onApply: (triple: GuidelineTriple) => void;
}

export function GuidelinePreviewDialog({
  open,
  onOpenChange,
  loading,
  result,
  error,
  onApply,
}: GuidelinePreviewDialogProps) {
  // Local edit buffer. Reset whenever a fresh `result` reference
  // arrives — React 19 idiom: compare-in-render against a shadow
  // state instead of an effect that would trip
  // `react-hooks/set-state-in-effect`.
  const [draft, setDraft] = useState<GuidelineTriple | null>(
    result ? { ...result.suggestion } : null,
  );
  const [prevResult, setPrevResult] = useState(result);
  if (prevResult !== result) {
    setPrevResult(result);
    setDraft(result ? { ...result.suggestion } : null);
  }

  const handleApply = useCallback(() => {
    if (!draft) return;
    onApply(draft);
    onOpenChange(false);
  }, [draft, onApply, onOpenChange]);

  const isApplyDisabled =
    loading ||
    !draft ||
    !draft.operational_context.trim() ||
    !draft.strategy.trim() ||
    !draft.key_messages.trim();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Block close while the LLM is still working — abort UX would
        // require AbortController plumbing, V1 keeps it simple.
        if (loading) return;
        onOpenChange(next);
      }}
    >
      <DialogContent
        showCloseButton={!loading}
        className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-2xl"
      >
        <DialogHeader className="shrink-0 border-b px-5 py-3">
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Sparkles className="h-4 w-4 text-primary" />
            AI Guidelines Preview
          </DialogTitle>
          <DialogDescription className="text-xs">
            Review and edit the AI-generated guidelines before applying.
            Anchored on the zone’s recent activity (posts, sentiment, top
            entities).
          </DialogDescription>
        </DialogHeader>

        <div
          className="flex-1 overflow-y-auto px-5 py-4"
          aria-busy={loading}
        >
          {error && !loading && (
            <div
              role="alert"
              className="mb-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2"
            >
              <p className="text-xs text-destructive">{error}</p>
            </div>
          )}

          {loading && <GenerationProgress />}

          {!loading && draft && (
            <div className="space-y-4">
              {GUIDELINE_FIELDS.map((field) => (
                <FieldEditor
                  key={field.key}
                  field={field}
                  value={draft[field.key]}
                  onChange={(v) =>
                    setDraft((prev) =>
                      prev ? { ...prev, [field.key]: v } : prev,
                    )
                  }
                />
              ))}

              {result && (
                <p className="pt-1 text-[10px] text-muted-foreground/70">
                  Generated in {(result.metadata.durationMs / 1000).toFixed(1)}s
                  {" · "}
                  {result.metadata.postsSampled} posts sampled
                  {" · "}
                  locale {result.metadata.locale.toUpperCase()}
                  {" · "}
                  {result.metadata.promptVersion}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t px-5 py-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button size="sm" onClick={handleApply} disabled={isApplyDisabled}>
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {loading ? "Generating…" : "Apply"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function FieldEditor({
  field,
  value,
  onChange,
}: {
  field: GuidelineFieldDefinition;
  value: string;
  onChange: (next: string) => void;
}) {
  const id = `ai-${field.slug}`;
  const Icon = field.icon;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="flex items-center gap-1.5 text-[11px]">
        <Icon className="h-3 w-3 text-muted-foreground" />
        {field.label}
      </Label>
      <Textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={5}
        className="resize-y text-xs leading-relaxed"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Generation progress — engaging loading state
// ---------------------------------------------------------------------------

const PROGRESS_STAGES: readonly { label: string; minMs: number }[] = [
  { label: "Reading the zone’s recent activity", minMs: 0 },
  { label: "Mapping sentiment patterns and top entities", minMs: 4_000 },
  { label: "Drafting operational context", minMs: 9_000 },
  { label: "Composing strategy", minMs: 16_000 },
  { label: "Distilling key messages", minMs: 24_000 },
  { label: "Finalising — almost there", minMs: 35_000 },
];

/**
 * Engaging loading state for the LLM call. Shows three skeleton blocks
 * (matching the final layout so the transition is visually smooth) plus
 * a stage label + elapsed timer that cycle as the call progresses.
 *
 * The stage labels are anchored to elapsed time, NOT to actual LLM
 * progress (we don't get streaming events from Aleria). The thresholds
 * are calibrated against a typical 25-40s generation so the labels
 * feel honest without making promises we can't keep.
 *
 * Resets every time it mounts — the parent's `loading` prop toggling
 * controls the lifecycle.
 */
function GenerationProgress() {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    // Anchor on mount inside the effect — render stays pure (React 19
    // `react-hooks/purity` forbids `Date.now()` as a ref initial value).
    const startedAt = Date.now();
    const id = setInterval(() => {
      setElapsedMs(Date.now() - startedAt);
    }, 250);
    return () => clearInterval(id);
  }, []);

  const stage =
    [...PROGRESS_STAGES].reverse().find((s) => elapsedMs >= s.minMs) ??
    PROGRESS_STAGES[0];
  const seconds = (elapsedMs / 1000).toFixed(1);

  return (
    <div className="space-y-4">
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-3 rounded-md border border-primary/20 bg-primary/5 px-3 py-2.5"
      >
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-foreground">
            {stage.label}…
          </p>
          <p className="text-[10px] text-muted-foreground">
            {seconds}s elapsed · usually 20–40s
          </p>
        </div>
      </div>

      {GUIDELINE_FIELDS.map((field) => {
        const Icon = field.icon;
        return (
          <div key={field.key} className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <Icon className="h-3 w-3 text-muted-foreground/50" />
              <Skeleton className="h-3 w-32" />
            </div>
            <Skeleton className="h-20 w-full rounded-md" />
          </div>
        );
      })}
    </div>
  );
}
