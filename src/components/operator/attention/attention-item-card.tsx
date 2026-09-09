"use client";

import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Check, Hand, Hourglass, Image as ImageIcon, Loader2, Server, Smartphone, UserRound, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AttentionReasonBadge, AttentionStatusBadge } from "@/components/shared/attention-badge";
import { cn } from "@/lib/utils";
import { ATTENTION_SCOPE_LABEL, ATTENTION_SOURCE_LABEL, attentionReasonMeta } from "@/lib/presentation/attention";
import type { AttentionQueueItem } from "@/types";

const SCOPE_ICON = {
  avatar_platform: UserRound,
  device: Smartphone,
  box: Server,
} as const;

/** Still on somebody's plate and not yet waiting on the server's probe. */
function canBeActedOn(item: AttentionQueueItem): boolean {
  return item.status === "open" || item.status === "reopened" || item.status === "in_progress";
}

/**
 * One attention item: the reason as a tinted badge, the server's title and
 * detail, the evidence it was opened on, what it is about, and the verbs a
 * human owns — take it, or say it is done. Resolving outright is the
 * manager's and admin's third verb (`canResolve`). Mirrors the macOS
 * `AttentionRow` word for word.
 */
export function AttentionItemCard({
  item,
  target,
  canResolve,
  onOpen,
  onAcknowledge,
  onDone,
  onResolve,
}: {
  item: AttentionQueueItem;
  target: string | null;
  canResolve: boolean;
  onOpen?: () => void;
  onAcknowledge: () => Promise<void>;
  onDone: () => Promise<void>;
  onResolve: () => void;
}) {
  const [busy, setBusy] = useState<"ack" | "done" | null>(null);
  const tone = attentionReasonMeta(item.reason).tone;
  const ScopeIcon = SCOPE_ICON[item.scope];
  const evidence = item.evidence ?? {};
  const hasEvidence = Boolean(evidence.screen_state || evidence.tikhub_status || evidence.proof_path || evidence.observed);

  const run = async (kind: "ack" | "done", action: () => Promise<void>) => {
    setBusy(kind);
    try {
      await action();
    } finally {
      setBusy(null);
    }
  };

  // The card is a plain box; the headline and title form the one clickable
  // region (a real button, so no interactive element nests inside another),
  // and the verbs stay siblings of it.
  const openable = Boolean(onOpen);
  const Headline = openable ? "button" : "div";

  return (
    <div
      className={cn(
        "rounded-lg border p-2.5 text-left transition-colors",
        tone === "critical" ? "border-destructive/25 bg-destructive/4" : "border-border bg-card",
      )}
    >
      <Headline
        {...(openable ? { type: "button" as const, onClick: onOpen, title: "Open this avatar" } : {})}
        className={cn(
          "block w-full text-left",
          openable && "rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_p:first-of-type]:hover:underline",
        )}
      >
      <div className="flex flex-wrap items-center gap-1.5">
        <AttentionReasonBadge reason={item.reason} />
        <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
          <ScopeIcon className="h-3 w-3" />
          {ATTENTION_SCOPE_LABEL[item.scope]}
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          {item.status !== "open" && <AttentionStatusBadge status={item.status} />}
          {item.reopen_count > 0 && (
            <span
              className="text-[10px] tabular-nums text-muted-foreground"
              title={`Reopened ${item.reopen_count} time(s) — the fix did not hold`}
            >
              ×{item.reopen_count + 1}
            </span>
          )}
        </span>
      </div>

      <p className="mt-1.5 text-xs font-medium leading-snug">{item.title}</p>
      {item.detail && <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{item.detail}</p>}
      </Headline>

      {hasEvidence && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
          {evidence.screen_state && (
            <span className="rounded-full bg-muted/40 px-2 py-0.5 font-mono">{evidence.screen_state}</span>
          )}
          {evidence.tikhub_status && (
            <span className="rounded-full bg-muted/40 px-2 py-0.5">TikHub · {evidence.tikhub_status}</span>
          )}
          {evidence.proof_path && (
            <span className="inline-flex items-center gap-1">
              <ImageIcon className="h-3 w-3" /> Proof recorded
            </span>
          )}
          {evidence.observed && (
            <span className="font-mono">
              {evidence.expected ? `${evidence.observed} ≠ ${evidence.expected}` : evidence.observed}
            </span>
          )}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
        {target && <span className="truncate font-medium text-foreground/80">{target}</span>}
        <span>{formatDistanceToNow(new Date(item.opened_at), { addSuffix: true })}</span>
        <span>{ATTENTION_SOURCE_LABEL[item.source]}</span>
        <span className="ml-auto flex items-center gap-1">
          {item.status === "done_pending_reprobe" ? (
            <span className="inline-flex items-center gap-1">
              <Hourglass className="h-3 w-3" /> Verifying…
            </span>
          ) : (
            canBeActedOn(item) && (
              <>
                {item.status !== "in_progress" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 gap-1 px-1.5 text-[10px]"
                    disabled={busy !== null}
                    onClick={() => run("ack", onAcknowledge)}
                    title="Mark this item as being handled by you"
                  >
                    {busy === "ack" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Hand className="h-3 w-3" />}
                    Take
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 gap-1 px-1.5 text-[10px]"
                  disabled={busy !== null}
                  onClick={() => run("done", onDone)}
                  title="A probe verifies the fix; the item reopens if the screen is unchanged"
                >
                  {busy === "done" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                  Mark done
                </Button>
                {canResolve && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 gap-1 px-1.5 text-[10px] text-muted-foreground hover:text-destructive"
                    disabled={busy !== null}
                    onClick={onResolve}
                    title="Close without a probe (managers and admins)"
                  >
                    <XCircle className="h-3 w-3" />
                    Resolve
                  </Button>
                )}
              </>
            )
          )}
        </span>
      </div>
    </div>
  );
}
