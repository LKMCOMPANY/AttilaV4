"use client";

import { cn } from "@/lib/utils";
import { ExternalLink, User, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SocialIcon } from "@/components/icons/social-icons";
import { DeviceScreenshot } from "./device-screenshot";
import { JobErrorBadge, JobStatusIcon, JobStatusLabel } from "./pipeline-status";
import { formatDistanceToNow, format } from "date-fns";
import { parseJobError } from "@/lib/automation/errors";
import type { CampaignJobWithAvatar, SocialPlatform } from "@/types";

// ---------------------------------------------------------------------------
// Job row
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
  return (
    <button
      onClick={onSelect}
      className={cn(
        "flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left text-xs transition-colors",
        selected
          ? "bg-primary/5 ring-1 ring-primary/20"
          : "hover:bg-muted/50"
      )}
    >
      <JobStatusIcon status={job.status} className="mt-0.5" />

      <div className="min-w-0 flex-1">
        <p className="truncate font-medium leading-snug">{job.comment_text}</p>

        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
          {job.avatar_name && (
            <span className="inline-flex items-center gap-0.5">
              <User className="h-2.5 w-2.5" />
              {job.avatar_name}
            </span>
          )}
          <span className="inline-flex items-center gap-0.5">
            <SocialIcon
              platform={job.platform as SocialPlatform}
              className="h-2.5 w-2.5"
            />
            {job.platform}
          </span>
          <span>
            {formatDistanceToNow(new Date(job.created_at), {
              addSuffix: true,
            })}
          </span>
          {job.duration_ms != null && (
            <span className="tabular-nums">
              {(job.duration_ms / 1000).toFixed(1)}s
            </span>
          )}
        </div>

        {job.status === "failed" && job.error_message && (
          <div className="mt-1">
            <JobErrorBadge errorMessage={job.error_message} />
          </div>
        )}
      </div>

      <JobStatusLabel status={job.status} />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Job detail (bottom panel)
// ---------------------------------------------------------------------------

interface PipelineJobDetailProps {
  job: CampaignJobWithAvatar;
  onClose: () => void;
}

export function PipelineJobDetail({ job, onClose }: PipelineJobDetailProps) {
  return (
    <div className="shrink-0 border-t bg-card">
      <div className="flex items-center justify-between px-3 py-1.5">
        <span className="text-caption">Job Detail</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5"
          onClick={onClose}
        >
          <X className="h-3 w-3" />
          <span className="sr-only">Close</span>
        </Button>
      </div>

      <div className="space-y-2 px-3 pb-3">
        <DetailField label="Comment" value={job.comment_text} />

        {job.avatar_name && (
          <DetailField label="Avatar" value={job.avatar_name} />
        )}

        <div>
          <span className="text-caption">Post URL</span>
          <a
            href={job.post_url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-primary hover:underline"
          >
            {job.post_url}
            <ExternalLink className="h-2.5 w-2.5 shrink-0" />
          </a>
        </div>

        {job.error_message && <JobErrorDetail errorMessage={job.error_message} />}

        <div>
          <span className="text-caption">Timeline</span>
          <div className="mt-0.5 grid grid-cols-2 gap-x-3 gap-y-0.5">
            <TimelineEntry label="Queued" timestamp={job.queued_at} />
            <TimelineEntry label="Scheduled" timestamp={job.scheduled_at} />
            <TimelineEntry label="Started" timestamp={job.started_at} />
            <TimelineEntry label="Completed" timestamp={job.completed_at} />
          </div>
          {job.duration_ms != null && (
            <p className="mt-0.5 text-[10px] tabular-nums text-muted-foreground">
              Duration: {(job.duration_ms / 1000).toFixed(1)}s
            </p>
          )}
        </div>

        {(job.source_screenshot || job.proof_screenshot) && (
          <div>
            <span className="text-caption">Screenshots</span>
            <div className="mt-0.5 flex gap-2.5">
              {job.source_screenshot && (
                <div>
                  <span className="text-[9px] text-muted-foreground/60">
                    Source
                  </span>
                  <DeviceScreenshot
                    url={job.source_screenshot}
                    alt="Source screenshot"
                  />
                </div>
              )}
              {job.proof_screenshot && (
                <div>
                  <span className="text-[9px] text-muted-foreground/60">
                    Proof
                  </span>
                  <DeviceScreenshot
                    url={job.proof_screenshot}
                    alt="Proof screenshot"
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-caption">{label}</span>
      <p className="mt-0.5 text-[11px] leading-relaxed">{value}</p>
    </div>
  );
}

function JobErrorDetail({ errorMessage }: { errorMessage: string }) {
  const parsed = parseJobError(errorMessage);
  if (!parsed) return null;
  const hint = HINT_BY_SEVERITY[parsed.severity];
  return (
    <div>
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-medium uppercase text-destructive">
          Error
        </span>
        <JobErrorBadge errorMessage={errorMessage} />
      </div>
      <p className="mt-0.5 text-[11px] leading-snug text-destructive/80">
        {parsed.message}
      </p>
      {hint && (
        <p className="mt-0.5 text-[10px] italic leading-snug text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}

const HINT_BY_SEVERITY: Record<string, string> = {
  action_required:
    "Open this device in the operator panel and resolve the dialog manually.",
  transient:
    "Will likely succeed on the next retry — leave the campaign running.",
  terminal:
    "This specific post will never succeed. The campaign will move on automatically.",
  bug: "Unexpected state — share the screenshots with the dev team.",
};

function TimelineEntry({
  label,
  timestamp,
}: {
  label: string;
  timestamp: string | null;
}) {
  return (
    <div className="flex items-baseline gap-1.5 text-[10px]">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">
        {timestamp ? format(new Date(timestamp), "HH:mm:ss") : "—"}
      </span>
    </div>
  );
}
