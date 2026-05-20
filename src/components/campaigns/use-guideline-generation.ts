"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  generateCampaignGuidelines,
  type GenerateGuidelinesInput,
  type GenerateGuidelinesResponse,
} from "@/app/actions/campaigns";

/**
 * Hook driving the AI-guideline generation lifecycle for a single
 * campaign. Used by both the create-campaign wizard (Step 4) and the
 * Automator detail panel (campaign-center-panel).
 *
 * Encapsulates:
 *   - the in-flight transition (so the button can disable itself)
 *   - dialog open/close state
 *   - latest result + error (mutually exclusive)
 *   - reset-on-close so a previous result doesn't flash on a fresh open
 *   - request-id guard so a second call started before the first
 *     finishes never sees the first response leak into the UI
 *
 * Surface kept tiny on purpose — the component decides what to do
 * with the applied triple (form patch vs. server save), the hook only
 * fetches.
 */

export interface UseGuidelineGenerationReturn {
  /** True while the action is in flight. */
  isGenerating: boolean;
  /** Whether the dialog is mounted/open. */
  isDialogOpen: boolean;
  setDialogOpen: (open: boolean) => void;
  /** Latest LLM result — null while loading, after a reset, or on error. */
  result: GenerateGuidelinesResponse | null;
  /** Error from the last call — null on success or when not yet called. */
  error: string | null;
  /**
   * Open the dialog and kick off generation. The caller passes the
   * `GenerateGuidelinesInput` discriminated union — `saved` for the
   * Automator panel, `draft` for the create-campaign wizard.
   */
  start: (input: GenerateGuidelinesInput) => void;
}

export function useGuidelineGeneration(): UseGuidelineGenerationReturn {
  const [isPending, startTransition] = useTransition();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [result, setResult] = useState<GenerateGuidelinesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Monotonic counter — last "intent" id. Any in-flight call whose id
  // differs from this on resolution is stale and dropped silently.
  const lastIntentRef = useRef(0);

  const start = useCallback((input: GenerateGuidelinesInput) => {
    const intent = ++lastIntentRef.current;
    setIsDialogOpen(true);
    setResult(null);
    setError(null);
    startTransition(async () => {
      const response = await generateCampaignGuidelines(input);
      // Drop late responses if a newer call has been issued OR the user
      // has closed the dialog meanwhile (close resets `lastIntentRef`).
      if (intent !== lastIntentRef.current) return;
      if (response.error) {
        setError(response.error);
        setResult(null);
        toast.error("Generation failed", { description: response.error });
        return;
      }
      setResult(response.data);
    });
  }, []);

  const setDialogOpen = useCallback((open: boolean) => {
    setIsDialogOpen(open);
    if (!open) {
      // Bump the intent so any in-flight response is treated as stale
      // and never mutates state of a closed dialog.
      lastIntentRef.current += 1;
      setResult(null);
      setError(null);
    }
  }, []);

  return {
    isGenerating: isPending,
    isDialogOpen,
    setDialogOpen,
    result,
    error,
    start,
  };
}
