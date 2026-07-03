"use client";

import { Info } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Inline help affordance: a small (i) icon revealing a tooltip.
 * Used next to labels and metrics that need a one-line definition.
 * Relies on the global `TooltipProvider` mounted in `providers.tsx`.
 */
export function InfoTip({
  children,
  side = "top",
  className,
}: {
  children: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            // Focusable so keyboard users can open the tooltip too
            // (base-ui opens on focus). Not a <button>: InfoTip lives
            // inside <Label> elements where a nested button would
            // hijack the label's click-to-focus behaviour.
            tabIndex={0}
            aria-label="More information"
            className={cn(
              "inline-flex shrink-0 cursor-help items-center rounded-sm text-muted-foreground/50 transition-colors hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              className,
            )}
          />
        }
      >
        <Info className="h-2.5 w-2.5" />
      </TooltipTrigger>
      <TooltipContent side={side} className="max-w-60 whitespace-normal leading-relaxed">
        {children}
      </TooltipContent>
    </Tooltip>
  );
}
