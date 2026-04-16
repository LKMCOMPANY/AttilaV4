"use client";

/**
 * ClusterToolbar — Dimension selector for the constellation map.
 */

import { memo } from "react";
import {
  Shield,
  Activity,
  Globe,
  Brain,
  UserCog,
  Zap,
  Share2,
  Smartphone,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { DIMENSION_CONFIGS, type ClusterDimension } from "@/types/cartography";

// ---------------------------------------------------------------------------
// Icon map
// ---------------------------------------------------------------------------

const DIMENSION_ICONS: Record<ClusterDimension, React.ElementType> = {
  army: Shield,
  status: Activity,
  identity: Globe,
  personality: Brain,
  operator_usage: UserCog,
  automator_usage: Zap,
  platform: Share2,
  device: Smartphone,
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ClusterToolbarProps {
  active: ClusterDimension;
  onChange: (dimension: ClusterDimension) => void;
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const ClusterToolbar = memo(function ClusterToolbar({
  active,
  onChange,
  className,
}: ClusterToolbarProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-0.5 rounded-lg border bg-card/80 p-1 backdrop-blur-sm",
        className
      )}
    >
      {DIMENSION_CONFIGS.map((dim) => {
        const Icon = DIMENSION_ICONS[dim.id];
        const isActive = active === dim.id;

        return (
          <Tooltip key={dim.id}>
            <TooltipTrigger
              render={
                <Button
                  variant={isActive ? "secondary" : "ghost"}
                  size="sm"
                  className={cn(
                    "h-8 gap-1.5 px-2.5 text-xs transition-all",
                    isActive && "bg-primary/10 text-primary shadow-sm"
                  )}
                  onClick={() => onChange(dim.id)}
                />
              }
            >
              <Icon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{dim.label}</span>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              {dim.description}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
});
