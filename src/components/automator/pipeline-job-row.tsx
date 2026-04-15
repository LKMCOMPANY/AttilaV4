"use client";

import { cn } from "@/lib/utils";
import { ExternalLink, User } from "lucide-react";
import { SocialIcon } from "@/components/icons/social-icons";
import { DeviceScreenshot } from "./device-screenshot";
import { JobStatusIcon, JobStatusBadge } from "./pipeline-status";
import { formatDistanceToNow, format } from "date-fns";
import type { CampaignJobWithAvatar, SocialPlatform } from "@/types";

// ---------------------------------------------------------------------------
// Job row
// ---------------------------------------------------------------------------

interface PipelineJobRowProps {
  job: CampaignJobWithAvatar;
  selected: boolean;
  onSelect: () => void;
}

export function PipelineJobRow({ job, selected, onSelect }: PipelineJobRowProps) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        "group flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs transition-colors",
        selected ? "bg-primary/10 text-foreground" : "hover:bg-muted/50"
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
            {formatDistanceToNow(new Date(job.created_at), { addSuffix: true })}
          </span>
          {job.duration_ms != null && (
            <span className="tabular-nums">{(job.duration_ms / 1000).toFixed(1)}s</span>
          )}
        </div>
      </div>

      <JobStatusBadge status={job.status} />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Job detail (expandable bottom panel)
// ---------------------------------------------------------------------------

interface PipelineJobDetailProps {
  job: CampaignJobWithAvatar;
  onClose: () => void;
}

export function PipelineJobDetail({ job, onClose }: PipelineJobDetailProps) {
  return (
    <div className="shrink-0 border-t bg-muted/20">
      <div className="flex items-center justify-between border-b border-border/50 px-3 py-1.5">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Job detail
        </span>
        <button
          onClick={onClose}
          className="text-[10px] text-muted-foreground hover:text-foreground"
        >
          Close
        </button>
      </div>

      <div className="space-y-2.5 p-3">
        <DetailField label="Comment" value={job.comment_text} />

        {job.avatar_name && (
          <DetailField label="Avatar" value={job.avatar_name} />
        )}

        <div>
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Post URL
          </span>
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

        {job.error_message && (
          <div>
            <span className="text-[10px] font-medium uppercase tracking-wider text-destructive">
              Error
            </span>
            <p className="mt-0.5 text-[11px] text-destructive/80">
              {job.error_message}
            </p>
          </div>
        )}

        <div>
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Timeline
          </span>
          <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1">
            <TimelineEntry label="Queued" timestamp={job.queued_at} />
            <TimelineEntry label="Scheduled" timestamp={job.scheduled_at} />
            <TimelineEntry label="Started" timestamp={job.started_at} />
            <TimelineEntry label="Completed" timestamp={job.completed_at} />
          </div>
          {job.duration_ms != null && (
            <p className="mt-1 text-[10px] tabular-nums text-muted-foreground">
              Duration: {(job.duration_ms / 1000).toFixed(1)}s
            </p>
          )}
        </div>

        {(job.source_screenshot || job.proof_screenshot) && (
          <div>
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Screenshots
            </span>
            <div className="mt-1 flex gap-3">
              {job.source_screenshot && (
                <div>
                  <span className="text-[9px] text-muted-foreground/60">Source</span>
                  <DeviceScreenshot url={job.source_screenshot} alt="Source screenshot" />
                </div>
              )}
              {job.proof_screenshot && (
                <div>
                  <span className="text-[9px] text-muted-foreground/60">Proof</span>
                  <DeviceScreenshot url={job.proof_screenshot} alt="Proof screenshot" />
                </div>
              )}
            </div>
          </div>
        )}

        <div className="flex items-center justify-end pt-1">
          <JobStatusBadge status={job.status} />
        </div>
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
      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <p className="mt-0.5 text-[11px] leading-relaxed">{value}</p>
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
    <div className="flex items-baseline gap-1.5 text-[10px]">
      <span className="text-muted-foreground">{label}:</span>
      <span className="tabular-nums">
        {timestamp ? format(new Date(timestamp), "HH:mm:ss") : "—"}
      </span>
    </div>
  );
}
