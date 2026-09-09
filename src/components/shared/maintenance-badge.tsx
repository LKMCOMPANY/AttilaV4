import { formatDistanceToNow } from "date-fns";
import { Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ON_DEVICE_STATUS_META,
  TASK_STATUS_META,
  actionableOnDeviceStatus,
  type MaintenanceTone,
} from "@/lib/presentation/maintenance";
import type { AvatarPlatformStateSummary, MaintenanceTaskStatus } from "@/types";

// ---------------------------------------------------------------------------
// Maintenance — visual layer over `lib/presentation/maintenance.ts`. Tone →
// colour is the same mapping the macOS client applies.
// ---------------------------------------------------------------------------

const TONE_CLASS: Record<MaintenanceTone, { text: string; bg: string }> = {
  critical: { text: "text-destructive", bg: "bg-destructive/10" },
  watch: { text: "text-warning", bg: "bg-warning/10" },
  ok: { text: "text-success", bg: "bg-success/10" },
  info: { text: "text-info", bg: "bg-info/10" },
  muted: { text: "text-muted-foreground", bg: "bg-muted/40" },
};

/**
 * What the DEVICE last showed for this account — rendered only when the
 * single rule `actionableOnDeviceStatus` says it is worth a look (fresh,
 * dated, not healthy), so a quiet fleet stays quiet. `showOk` renders the
 * reassuring "Logged in" too (credentials panel).
 */
export function OnDeviceBadge({
  state,
  showOk = false,
  className,
}: {
  state: AvatarPlatformStateSummary | null | undefined;
  showOk?: boolean;
  className?: string;
}) {
  const actionable = actionableOnDeviceStatus(state);
  const status = actionable ?? (showOk && state?.on_device_status === "logged_in" && state.probed_at ? "logged_in" : null);
  if (!status || !state) return null;
  const meta = ON_DEVICE_STATUS_META[status];
  const tone = TONE_CLASS[meta.tone];
  const title = state.probed_at
    ? `On the device: ${meta.label.toLowerCase()} — probed ${formatDistanceToNow(new Date(state.probed_at), { addSuffix: true })}.`
    : `On the device: ${meta.label.toLowerCase()}.`;
  return (
    <span
      title={title}
      className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium", tone.text, tone.bg, className)}
    >
      <Smartphone className="h-2.5 w-2.5" />
      {meta.label}
    </span>
  );
}

export function TaskStatusBadge({ status, className }: { status: MaintenanceTaskStatus; className?: string }) {
  const meta = TASK_STATUS_META[status];
  const tone = TONE_CLASS[meta.tone];
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", tone.text, tone.bg, className)}>{meta.label}</span>
  );
}
