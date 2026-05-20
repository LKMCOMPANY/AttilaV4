"use client";

import { useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BookOpen,
  Loader2,
  MessageSquare,
  Sparkles,
  Target,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { GenerateGuidelinesResponse } from "@/app/actions/campaigns";

/**
 * Reusable preview dialog for AI-generated guideline triples.
 *
 * Lifecycle (per-instance, controlled by the parent via `open`):
 *   `open=false`              → dialog closed, no state held
 *   `open=true && loading`    → 3 skeleton blocks, "Generating…" label
 *   `open=true && !loading`   → 3 editable Textareas pre-filled with the
 *                               LLM output. Operator edits in place
 *                               before clicking Apply.
 *   `error`                   → muted error banner replaces the form
 *
 * The textareas are LOCAL state — the parent only sees the final
 * triple via `onApply` so an operator who closes the dialog discards
 * their edits. This keeps the parent simple (no draft management).
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            AI Guidelines Preview
          </DialogTitle>
          <DialogDescription>
            Review and edit the AI-generated guidelines before applying.
            Anchored on the zone’s recent activity (posts, sentiment, top
            entities).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2" aria-busy={loading}>
          {error && !loading && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
              <p className="text-xs text-destructive">{error}</p>
            </div>
          )}

          {loading && <PreviewSkeletons />}

          {!loading && draft && (
            <>
              <FieldEditor
                id="ai-operational-context"
                label="Operational Context"
                icon={BookOpen}
                value={draft.operational_context}
                onChange={(v) =>
                  setDraft((prev) =>
                    prev ? { ...prev, operational_context: v } : prev,
                  )
                }
              />
              <FieldEditor
                id="ai-strategy"
                label="Strategy"
                icon={Target}
                value={draft.strategy}
                onChange={(v) =>
                  setDraft((prev) => (prev ? { ...prev, strategy: v } : prev))
                }
              />
              <FieldEditor
                id="ai-key-messages"
                label="Key Messages"
                icon={MessageSquare}
                value={draft.key_messages}
                onChange={(v) =>
                  setDraft((prev) =>
                    prev ? { ...prev, key_messages: v } : prev,
                  )
                }
              />

              {result && (
                <p className="text-[10px] text-muted-foreground/70">
                  Generated in {(result.metadata.durationMs / 1000).toFixed(1)}s
                  {" · "}
                  {result.metadata.postsSampled} posts sampled
                  {" · "}
                  locale {result.metadata.locale.toUpperCase()}
                  {" · "}
                  {result.metadata.promptVersion}
                </p>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button onClick={handleApply} disabled={isApplyDisabled}>
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {loading ? "Generating…" : "Apply"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function FieldEditor({
  id,
  label,
  icon: Icon,
  value,
  onChange,
}: {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="flex items-center gap-1.5 text-[11px]">
        <Icon className="h-3 w-3 text-muted-foreground" />
        {label}
      </Label>
      <Textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={5}
        className={cn("resize-y text-xs leading-relaxed")}
      />
    </div>
  );
}

function PreviewSkeletons() {
  return (
    <>
      {[BookOpen, Target, MessageSquare].map((Icon, idx) => (
        <div key={idx} className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Icon className="h-3 w-3 text-muted-foreground/50" />
            <Skeleton className="h-3 w-32" />
          </div>
          <Skeleton className="h-24 w-full rounded-md" />
        </div>
      ))}
    </>
  );
}
