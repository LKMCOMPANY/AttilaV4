"use client";

import { cn } from "@/lib/utils";
import {
  CheckCircle2,
  ExternalLink,
  RotateCcw,
  ShieldCheck,
  ShieldQuestion,
  X,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SocialIcon } from "@/components/icons/social-icons";
import { DeviceScreenshot } from "./device-screenshot";
import {
  JobErrorBadge,
  JobStatusIcon,
  JobStatusLabel,
  JobVerificationBadge,
} from "./pipeline-status";
import { formatDistanceToNow, format } from "date-fns";
import { parseJobError } from "@/lib/automation/errors";
import type { CampaignJobWithAvatar, SocialPlatform } from "@/types";

// ---------------------------------------------------------------------------
// Job row — one avatar response attempt. Reads: WHO (avatar) → outcome →
// WHAT was written → context (platform, when, retries).
// ---------------------------------------------------------------------------

interface PipelineJobRowProps {
  job: CampaignJobWithAvatar;
  selected: boolean;
  onSelect: () => void;
}

export function PipelineJobRow({
  job,
  selected,
  onSelect,
}: PipelineJobRowProps) {
  const retried = (job.attempts ?? 0) > 1 ||
    ((job.attempts ?? 0) > 0 && job.status === "ready");

  return (
    <button
      onClick={onSelect}
      className={cn(
        "flex w-full items-start gap-2.5 rounded-md px-2.5 py-2.5 text-left transition-colors",
        selected ? "bg-primary/5 ring-1 ring-primary/20" : "hover:bg-muted/50",
      )}
    >
      <JobStatusIcon status={job.status} className="mt-1 h-3.5 w-3.5" />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[13px] font-semibold text-foreground">
            {job.avatar_name ?? "Unknown avatar"}
          </span>
          <SocialIcon
            platform={job.platform as SocialPlatform}
            className="h-3 w-3 shrink-0 text-muted-foreground"
          />
          <span className="ml-auto shrink-0">
            <JobStatusLabel status={job.status} />
          </span>
        </div>

        <p className="truncate-multiline truncate-2 mt-1 text-xs leading-normal text-muted-foreground">
          {job.comment_text}
        </p>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
          <span>
            {formatDistanceToNow(new Date(job.completed_at ?? job.scheduled_at), {
              addSuffix: true,
            })}
          </span>
          {job.duration_ms != null && (
            <span className="tabular-nums">
              · {(job.duration_ms / 1000).toFixed(0)}s
            </span>
          )}
          {retried && (
            <span className="inline-flex items-center gap-1 text-warning">
              <RotateCcw className="h-2.5 w-2.5" />
              retry {Math.max(1, job.attempts ?? 0)}
            </span>
          )}
          {job.status === "failed" && (
            <JobErrorBadge errorMessage={job.error_message} />
          )}
          <JobVerificationBadge verification={job.verification} status={job.status} />
        </div>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Job detail (bottom drawer) — verdict first, then evidence, then metadata
// ---------------------------------------------------------------------------

interface PipelineJobDetailProps {
  job: CampaignJobWithAvatar;
  onClose: () => void;
}

export function PipelineJobDetail({ job, onClose }: PipelineJobDetailProps) {
  return (
    <div className="flex max-h-[60%] shrink-0 flex-col border-t bg-card">
      <div className="flex shrink-0 items-center justify-between border-b border-border/60 px-3 py-1.5">
        <span className="text-caption">Response detail</span>
        <Button variant="ghost" size="icon" className="h-5 w-5" onClick={onClose}>
          <X className="h-3 w-3" />
          <span className="sr-only">Close</span>
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-3 px-3 py-2.5">
          <JobVerdict job={job} />

          <div>
            <span className="text-caption">Comment</span>
            <p className="mt-0.5 text-xs leading-relaxed text-foreground">
              {job.comment_text}
            </p>
          </div>

          {job.avatar_name && (
            <div>
              <span className="text-caption">Avatar</span>
              <p className="mt-0.5 text-xs">{job.avatar_name}</p>
            </div>
          )}

          <div>
            <span className="text-caption">Target post</span>
            <a
              href={job.post_url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-0.5 flex items-center gap-1 truncate text-xs text-primary hover:underline"
            >
              {job.post_url}
              <ExternalLink className="h-2.5 w-2.5 shrink-0" />
            </a>
          </div>

          <JobEvidence job={job} />

          <div>
            <span className="text-caption">Timeline</span>
            <div className="mt-0.5 grid grid-cols-2 gap-x-3 gap-y-0.5">
              <TimelineEntry label="Queued" timestamp={job.queued_at} />
              <TimelineEntry label="Scheduled" timestamp={job.scheduled_at} />
              <TimelineEntry label="Started" timestamp={job.started_at} />
              <TimelineEntry label="Completed" timestamp={job.completed_at} />
            </div>
            {job.duration_ms != null && (
              <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
                Duration: {(job.duration_ms / 1000).toFixed(1)}s
              </p>
            )}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Verdict banner — shared with the post detail overlay
// ---------------------------------------------------------------------------

const HINT_BY_SEVERITY: Record<string, string> = {
  action_required:
    "Open this device in the operator panel and fix the account/dialog manually.",
  transient:
    "Temporary condition — it retries automatically, no action needed.",
  terminal:
    "This post can never be commented (deleted, private, or geo-blocked). The campaign moves on.",
  bug: "Unexpected state — share the screenshots with the dev team.",
};

export function JobVerdict({ job }: { job: CampaignJobWithAvatar }) {
  if (job.status === "done") {
    // `verification` is the independent off-device (TikHub) cross-check, layered
    // on top of the on-device "done": confirmed = seen on the target,
    // unconfirmed = device said done but TikHub can't find it (silent drop),
    // unchecked = still indexing / TikHub unavailable.
    if (job.verification === "unconfirmed") {
      return (
        <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-2.5 py-2">
          <ShieldQuestion className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-warning">Published — unconfirmed</p>
            <p className="mt-0.5 text-[11px] leading-snug text-foreground/80">
              The device reported the comment as sent, but the independent
              TikHub check can&apos;t find it on the target — a likely shadow-ban
              or silent drop. Treat as not-yet-verified.
            </p>
          </div>
        </div>
      );
    }
    const confirmed = job.verification === "confirmed";
    return (
      <div
        className={cn(
          "flex items-start gap-2 rounded-md border px-2.5 py-2",
          confirmed ? "border-success/25 bg-success/10" : "border-success/20 bg-success/5",
        )}
      >
        {confirmed ? (
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
        ) : (
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
        )}
        <div className="min-w-0">
          <p className="text-xs font-semibold text-success">
            {confirmed ? "Published — confirmed live" : "Comment published"}
          </p>
          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
            {confirmed
              ? "Confirmed on the device AND independently on the target via TikHub."
              : "Confirmed on the device — the comment appeared in the list after sending. Independent TikHub check pending."}
          </p>
        </div>
      </div>
    );
  }

  if (job.status !== "failed") return null;

  const parsed = parseJobError(job.error_message);
  const hint = parsed ? HINT_BY_SEVERITY[parsed.severity] : null;

  return (
    <div className="flex items-start gap-2 rounded-md border border-destructive/25 bg-destructive/10 px-2.5 py-2">
      <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="text-xs font-semibold text-destructive">Not published</p>
          <JobErrorBadge errorMessage={job.error_message} />
        </div>
        {parsed && (
          <p className="mt-0.5 text-[11px] leading-snug text-foreground/80">
            {parsed.message}
          </p>
        )}
        {hint && (
          <p className="mt-1 text-[11px] italic leading-snug text-muted-foreground">
            {hint}
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Evidence strip — labeled thumbnails, lightbox for full frames
// ---------------------------------------------------------------------------

export function JobEvidence({ job }: { job: CampaignJobWithAvatar }) {
  if (!job.source_screenshot && !job.proof_screenshot) return null;

  // The proof means different things on the two outcomes: on success the
  // backend upgrades it to the post LIVE (comment in list / reply in thread);
  // on failure it is the device's actual END state (the list without our
  // comment, a stuck composer, or a blocker screen) — never the pre-submit
  // composer, which would look like success.
  const proofCaption =
    job.status === "done" ? "Published — live on platform" : "Result on device (not published)";

  return (
    <div>
      <span className="text-caption">Evidence</span>
      <div className="mt-1 flex gap-2.5">
        {job.source_screenshot && (
          <DeviceScreenshot
            url={job.source_screenshot}
            alt="Target post as loaded on the device"
            caption="Target loaded"
          />
        )}
        {job.proof_screenshot && (
          <DeviceScreenshot
            url={job.proof_screenshot}
            alt={proofCaption}
            caption={proofCaption}
          />
        )}
      </div>
    </div>
  );
}

function TimelineEntry({
  label,
  timestamp,
}: {
  label: string;
  timestamp: string | null;
}) {
  return (
    <div className="flex items-baseline gap-1.5 text-[11px]">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">
        {timestamp ? format(new Date(timestamp), "HH:mm:ss") : "—"}
      </span>
    </div>
  );
}
