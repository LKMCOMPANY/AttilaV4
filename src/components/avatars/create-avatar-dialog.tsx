"use client";

import { useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Loader2, Check } from "lucide-react";
import { createAvatar, type CreateAvatarInput } from "@/app/actions/avatars";
import { StepCountry } from "./steps/step-country";
import { StepIdentity } from "./steps/step-identity";
import { StepPersonality } from "./steps/step-personality";
import { StepDevice } from "./steps/step-device";
import { StepSocial } from "./steps/step-social";
import { StepAttribution } from "./steps/step-attribution";
import { STEPS, DEFAULT_FORM_DATA, type AvatarFormData } from "./types";

interface CreateAvatarDialogProps {
  accountId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateAvatarDialog({
  accountId,
  open,
  onOpenChange,
}: CreateAvatarDialogProps) {
  const [step, setStep] = useState(0);
  const [formData, setFormData] = useState<AvatarFormData>(DEFAULT_FORM_DATA);
  const [submitting, setSubmitting] = useState(false);

  const handleChange = useCallback(
    (patch: Partial<AvatarFormData>) => {
      setFormData((prev) => ({ ...prev, ...patch }));
    },
    []
  );

  const handleClose = () => {
    if (submitting) return;
    onOpenChange(false);
    setTimeout(() => {
      setStep(0);
      setFormData(DEFAULT_FORM_DATA);
    }, 300);
  };

  const canAdvance = (): boolean => {
    switch (step) {
      case 0:
        return !!formData.country_code && !!formData.language_code;
      case 1:
        return !!formData.first_name.trim() && !!formData.last_name.trim();
      default:
        return true;
    }
  };

  const handleSubmit = async () => {
    setSubmitting(true);

    try {
      const input: CreateAvatarInput = {
        account_id: accountId,
        first_name: formData.first_name.trim(),
        last_name: formData.last_name.trim(),
        profile_image_url: formData.profile_image_url || null,
        email: formData.email || null,
        phone: formData.phone || null,
        country_code: formData.country_code,
        language_code: formData.language_code,
        device_id: formData.device_id,
        writing_style: formData.writing_style,
        tone: formData.tone,
        vocabulary_level: formData.vocabulary_level,
        emoji_usage: formData.emoji_usage,
        personality_traits: formData.personality_traits,
        topics_expertise: formData.topics_expertise,
        topics_avoid: formData.topics_avoid,
        twitter_enabled: formData.twitter_enabled,
        tiktok_enabled: formData.tiktok_enabled,
        reddit_enabled: formData.reddit_enabled,
        instagram_enabled: formData.instagram_enabled,
        twitter_credentials: formData.twitter_credentials,
        tiktok_credentials: formData.tiktok_credentials,
        reddit_credentials: formData.reddit_credentials,
        instagram_credentials: formData.instagram_credentials,
        operator_ids: formData.operator_ids,
        army_ids: formData.army_ids,
        new_army_names: formData.new_army_names,
      };

      const result = await createAvatar(input);

      if (result.error) {
        toast.error("Failed to create avatar", { description: result.error });
        return;
      }

      if (result.warnings?.length) {
        toast.warning("Avatar created with warnings", {
          description: result.warnings.join(". "),
        });
      } else {
        toast.success("Avatar created", {
          description: `${formData.first_name} ${formData.last_name} has been created.`,
        });
      }

      handleClose();
    } catch (err) {
      toast.error("Unexpected error", {
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const isLastStep = step === STEPS.length - 1;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className="flex max-h-[90vh] flex-col overflow-hidden sm:max-w-2xl lg:max-w-3xl"
        showCloseButton={!submitting}
      >
        <DialogHeader>
          <DialogTitle>Create Avatar</DialogTitle>
          <DialogDescription>
            Step {step + 1} of {STEPS.length} — {STEPS[step].label}
          </DialogDescription>
        </DialogHeader>

        {/* Stepper */}
        <nav aria-label="Creation progress" className="flex gap-1">
          {STEPS.map((s, i) => {
            const completed = i < step;
            const active = i === step;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => { if (completed) setStep(i); }}
                disabled={i > step}
                aria-current={active ? "step" : undefined}
                className="group relative flex-1"
                aria-label={`${s.label}${completed ? " (completed)" : active ? " (current)" : ""}`}
              >
                <div
                  className={`h-1.5 rounded-full transition-all duration-200 ${
                    completed
                      ? "bg-primary group-hover:bg-primary/80 cursor-pointer"
                      : active
                        ? "bg-primary"
                        : "bg-muted"
                  }`}
                />
                <span
                  className={`mt-1 hidden text-[10px] leading-tight sm:block ${
                    active
                      ? "font-medium text-foreground"
                      : completed
                        ? "text-primary cursor-pointer"
                        : "text-muted-foreground"
                  }`}
                >
                  {s.label}
                </span>
              </button>
            );
          })}
        </nav>

        {/* Step content */}
        <div className="min-h-0 flex-1 overflow-y-auto py-2 scrollbar-thin">
          <StepContent
            step={step}
            data={formData}
            onChange={handleChange}
            accountId={accountId}
          />
        </div>

        {/* Footer — custom div to avoid fighting with DialogFooter built-in styles */}
        <div className="-mx-4 -mb-4 flex items-center justify-between gap-2 rounded-b-xl border-t bg-muted/50 px-4 py-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0 || submitting}
            className="gap-1.5"
          >
            <ChevronLeft className="h-4 w-4" />
            Back
          </Button>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleClose}
              disabled={submitting}
            >
              Cancel
            </Button>

            {isLastStep ? (
              <Button
                size="sm"
                onClick={handleSubmit}
                disabled={submitting || !canAdvance()}
                className="gap-1.5"
              >
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                {submitting ? "Creating..." : "Create Avatar"}
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => setStep((s) => s + 1)}
                disabled={!canAdvance()}
                className="gap-1.5"
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StepContent({
  step,
  data,
  onChange,
  accountId,
}: {
  step: number;
  data: AvatarFormData;
  onChange: (patch: Partial<AvatarFormData>) => void;
  accountId: string;
}) {
  switch (step) {
    case 0:
      return <StepCountry data={data} onChange={onChange} />;
    case 1:
      return <StepIdentity data={data} onChange={onChange} />;
    case 2:
      return <StepPersonality data={data} onChange={onChange} />;
    case 3:
      return <StepDevice data={data} onChange={onChange} accountId={accountId} />;
    case 4:
      return <StepSocial data={data} onChange={onChange} />;
    case 5:
      return <StepAttribution data={data} onChange={onChange} accountId={accountId} />;
    default:
      return null;
  }
}
