"use client";

import { useState, useTransition } from "react";
import { Loader2, Wrench } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { TONE_CLASS } from "@/components/shared/tone-class";
import { setBoxMaintenance } from "@/app/actions/boxes";
import { BOX_MAINTENANCE_META, boxHealthVerdictMeta, boxPresenceMeta } from "@/lib/presentation/box-health";
import { cn } from "@/lib/utils";
import type { Box } from "@/types";

// ---------------------------------------------------------------------------
// What the presence writer observed about a box's host (25 September 2026):
// firmware facts (model, CBS, kernel, image — re-read hourly), the last host
// sample with the arbiter's verdict, and the maintenance window an admin can
// open before a firmware flash. Labels and tones come from the shared
// vocabulary (`lib/presentation/box-health.ts`); the numbers are shown raw.
// ---------------------------------------------------------------------------

const MAINTENANCE_CHOICES = [
  { minutes: 30, label: "30 min" },
  { minutes: 120, label: "2 h" },
  { minutes: 480, label: "8 h" },
];

function percent(value: number | null | undefined): string {
  return value == null ? "—" : `${Math.round(value)}%`;
}

function shortTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function Pill({ label, tone, title }: { label: string; tone: keyof typeof TONE_CLASS; title?: string }) {
  const classes = TONE_CLASS[tone];
  return (
    <span title={title} className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", classes.text, classes.bg)}>
      {label}
    </span>
  );
}

export function BoxHostFacts({ box, onUpdated }: { box: Box; onUpdated: () => void }) {
  const [isPending, startTransition] = useTransition();
  // Render-phase adjustment: track the last prop we saw so a fresh row from
  // the parent wins over our optimistic value (never an effect).
  const [seen, setSeen] = useState(box.maintenance_until);
  const [until, setUntil] = useState(box.maintenance_until);
  if (seen !== box.maintenance_until) {
    setSeen(box.maintenance_until);
    setUntil(box.maintenance_until);
  }

  const presence = boxPresenceMeta({ status: box.status, maintenance_until: until });
  const health = box.host_health;
  const verdict = boxHealthVerdictMeta(health?.verdict);
  // The presence rule already decided whether the window is open (it returns
  // the maintenance constant); no second clock read in render.
  const inMaintenance = presence === BOX_MAINTENANCE_META;

  const apply = (minutes: number | null) => {
    startTransition(async () => {
      const result = await setBoxMaintenance({ id: box.id, minutes });
      if (result.error) {
        toast.error("Maintenance window not changed", { description: result.error });
        return;
      }
      setUntil(result.maintenance_until);
      toast.success(minutes == null ? "Maintenance window closed" : `Maintenance window open for ${minutes} min`);
      onUpdated();
    });
  };

  return (
    <div className="space-y-2 rounded-md border bg-muted/20 px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <Pill label={presence.label} tone={presence.tone} />
        <Pill label={verdict.label} tone={verdict.tone} title={health?.over?.join(", ")} />
        {health && (
          <span className="text-muted-foreground">
            cpu {percent(health.cpu_percent)} · mem {percent(health.mem_percent)} · swap {percent(health.swap_percent)} · ssd{" "}
            {percent(health.ssd_percent)} · mmc {percent(health.mmc_percent)} · {health.running} running
            {health.starting > 0 && `, ${health.starting} starting`}
            {shortTime(health.sampled_at) && <span className="opacity-70"> · sampled {shortTime(health.sampled_at)}</span>}
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-muted-foreground">
        <span>model {box.model ?? "—"}</span>
        <span>cbs {box.cbs_version ?? "—"}</span>
        <span>kernel {box.kernel_version ?? "—"}</span>
        <span className="truncate">image {box.default_image ?? "—"}</span>
        {shortTime(box.firmware_checked_at) && <span className="opacity-70">read {shortTime(box.firmware_checked_at)}</span>}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Wrench className="h-3 w-3 text-muted-foreground" />
        {inMaintenance ? (
          <>
            <span className="text-muted-foreground">Maintenance until {shortTime(until)}</span>
            <Button variant="outline" size="sm" className="h-6 text-xs" disabled={isPending} onClick={() => apply(null)}>
              {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Close window"}
            </Button>
          </>
        ) : (
          <>
            <span className="text-muted-foreground">Open a maintenance window</span>
            {MAINTENANCE_CHOICES.map((choice) => (
              <Button
                key={choice.minutes}
                variant="ghost"
                size="sm"
                className="h-6 text-xs"
                disabled={isPending}
                onClick={() => apply(choice.minutes)}
              >
                {choice.label}
              </Button>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
