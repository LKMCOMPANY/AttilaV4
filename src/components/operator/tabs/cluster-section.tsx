"use client";

import { formatDistanceToNow } from "date-fns";
import { Users } from "lucide-react";
import { formatCount } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Section } from "./device-info";
import type { ClusterCandidate, ClusterCandidateStatus } from "@/types";

const STATUS_CLASS: Record<ClusterCandidateStatus, string> = {
  candidate: "text-muted-foreground bg-muted/40",
  followed: "text-success bg-success/10",
  skipped: "text-muted-foreground bg-muted/40",
  rejected: "text-warning bg-warning/10",
  failed: "text-destructive bg-destructive/10",
};

/**
 * The avatar's cluster (phase 3): the creators the discovery ranked from the
 * armies' keywords, and what the maintainer did about each — followed, skipped,
 * failed. Read-only: the sessions act, the humans watch.
 */
export function ClusterSection({ candidates }: { candidates: ClusterCandidate[] }) {
  const followed = candidates.filter((c) => c.status === "followed").length;
  return (
    <Section
      title="Cluster"
      icon={Users}
      action={
        candidates.length > 0 ? (
          <span className="text-[10px] tabular-nums text-muted-foreground">
            {followed} followed · {candidates.length} known
          </span>
        ) : undefined
      }
    >
      {candidates.length === 0 && (
        <p className="py-1.5 text-[11px] text-muted-foreground">
          No candidate yet — discovery runs at the start of each session once the armies carry cluster keywords and the account is mature.
        </p>
      )}
      {candidates.map((c) => (
        <div key={c.id} className="flex items-center justify-between gap-2 py-1.5">
          <div className="min-w-0">
            <p className="truncate text-[11px] font-medium">
              @{c.handle}
              {c.display_name && <span className="ml-1.5 font-normal text-muted-foreground">{c.display_name}</span>}
            </p>
            <p className="truncate text-[10px] text-muted-foreground">
              {c.followers != null && `${formatCount(c.followers)} followers · `}
              {c.keyword && `“${c.keyword}” · `}
              {c.acted_at
                ? formatDistanceToNow(new Date(c.acted_at), { addSuffix: true })
                : `found ${formatDistanceToNow(new Date(c.discovered_at), { addSuffix: true })}`}
            </p>
          </div>
          <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium", STATUS_CLASS[c.status])}>{c.status}</span>
        </div>
      ))}
    </Section>
  );
}
