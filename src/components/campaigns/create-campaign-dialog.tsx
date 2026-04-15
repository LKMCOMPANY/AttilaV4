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
import { createCampaign, type CreateCampaignInput } from "@/app/actions/campaigns";
import { StepBasics } from "./steps/step-basics";
import { StepZone } from "./steps/step-zone";
import { StepConfig } from "./steps/step-config";
import { StepGuidelines } from "./steps/step-guidelines";
import { STEPS, DEFAULT_FORM_DATA, type CampaignFormData } from "./types";

interface CreateCampaignDialogProps {
  accountId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateCampaignDialog({
  accountId,
  open,
  onOpenChange,
}: CreateCampaignDialogProps) {
  const [step, setStep] = useState(0);
  const [formData, setFormData] = useState<CampaignFormData>(DEFAULT_FORM_DATA);
  const [submitting, setSubmitting] = useState(false);

  const handleChange = useCallback(
    (patch: Partial<CampaignFormData>) => {
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
        return !!formData.name.trim() && formData.platforms.length > 0;
      case 1:
        return !!formData.gorgone_zone_id;
      default:
        return true;
    }
  };

  const handleSubmit = async () => {
    setSubmitting(true);

    try {
      const input: CreateCampaignInput = {
        account_id: accountId,
        name: formData.name.trim(),
        mode: formData.mode,
        platforms: formData.platforms,
        gorgone_zone_id: formData.gorgone_zone_id,
        gorgone_zone_name: formData.gorgone_zone_name || null,
        army_ids: formData.army_ids,
        filters: formData.filters,
        operational_context: formData.operational_context || null,
        strategy: formData.strategy || null,
        key_messages: formData.key_messages || null,
      };

      const result = await createCampaign(input);

      if (result.error) {
        toast.error("Failed to create campaign", {
          description: result.error,
        });
        return;
      }

      toast.success("Campaign created", {
        description: `${formData.name} has been created as draft.`,
      });

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
        className="max-h-[80vh] flex flex-col overflow-hidden sm:max-w-2xl lg:max-w-3xl"
        showCloseButton={!submitting}
      >
        <DialogHeader>
          <DialogTitle>Create Campaign</DialogTitle>
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
                onClick={() => {
                  if (completed) setStep(i);
                }}
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

        {/* Footer */}
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
                {submitting ? "Creating..." : "Create Campaign"}
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
  data: CampaignFormData;
  onChange: (patch: Partial<CampaignFormData>) => void;
  accountId: string;
}) {
  switch (step) {
    case 0:
      return <StepBasics data={data} onChange={onChange} accountId={accountId} />;
    case 1:
      return <StepZone data={data} onChange={onChange} accountId={accountId} />;
    case 2:
      return <StepConfig data={data} onChange={onChange} accountId={accountId} />;
    case 3:
      return <StepGuidelines data={data} onChange={onChange} accountId={accountId} />;
    default:
      return null;
  }
}
