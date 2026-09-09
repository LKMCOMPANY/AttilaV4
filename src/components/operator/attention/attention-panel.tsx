"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, ListFilter, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { EmptyPanel } from "@/components/ui/empty";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AttentionSeverityBadge } from "@/components/shared/attention-badge";
import { AttentionItemCard } from "./attention-item-card";
import { cn } from "@/lib/utils";
import { ATTENTION_SCOPE_LABEL } from "@/lib/presentation/attention";
import type { AttentionQueue } from "@/hooks/use-attention-queue";
import {
  ATTENTION_SCOPES,
  ATTENTION_SEVERITY_RANK,
  type AttentionQueueItem,
  type AttentionScope,
  type AvatarWithRelations,
} from "@/types";

/**
 * The attention queue of the workspace, in the server's order of urgency:
 * everything a human must do — reconnect an account, update an app, look at
 * a box. Same grammar as the roster panel (header, lens chips, dense rows);
 * an account item aims the details panel at its avatar.
 */
export function AttentionPanel({
  queue,
  avatars,
  canResolve,
  onBack,
  onSelectAvatar,
}: {
  queue: AttentionQueue;
  avatars: AvatarWithRelations[];
  canResolve: boolean;
  onBack: () => void;
  onSelectAvatar: (avatarId: string) => void;
}) {
  const [scope, setScope] = useState<AttentionScope | null>(null);
  const [resolving, setResolving] = useState<AttentionQueueItem | null>(null);
  const [resolvingBusy, setResolvingBusy] = useState(false);

  const worst = useMemo(() => {
    let top: AttentionQueueItem["severity"] | null = null;
    for (const item of queue.items) {
      if (!top || ATTENTION_SEVERITY_RANK[item.severity] > ATTENTION_SEVERITY_RANK[top]) top = item.severity;
    }
    return top;
  }, [queue.items]);

  const counts = useMemo(() => {
    const map: Partial<Record<AttentionScope, number>> = {};
    for (const item of queue.items) map[item.scope] = (map[item.scope] ?? 0) + 1;
    return map;
  }, [queue.items]);

  const visible = scope ? queue.items.filter((item) => item.scope === scope) : queue.items;

  /** What the item is about, resolved from the roster already in memory. */
  const targetOf = (item: AttentionQueueItem): string | null => {
    if (item.scope === "avatar_platform") {
      const avatar = avatars.find((a) => a.id === item.avatar_id);
      if (!avatar) return null;
      const platform = item.platform ? ` · ${item.platform === "twitter" ? "X" : item.platform}` : "";
      return `${avatar.first_name} ${avatar.last_name}${platform}`;
    }
    if (item.scope === "device") {
      const avatar = avatars.find((a) => a.device?.id === item.device_id);
      return avatar?.device?.user_name ?? avatar?.device?.db_id ?? null;
    }
    return null;
  };

  const doResolve = async () => {
    if (!resolving) return;
    setResolvingBusy(true);
    try {
      await queue.resolve(resolving);
      setResolving(null);
    } finally {
      setResolvingBusy(false);
    }
  };

  return (
    <div className="@container/list flex h-full flex-col bg-background">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b px-2">
        <Button variant="ghost" size="sm" className="h-7 gap-1 px-1.5" onClick={onBack}>
          <ArrowLeft className="h-3.5 w-3.5" />
          <span className="text-xs">Avatars</span>
        </Button>
        <h2 className="text-xs font-semibold tracking-widest uppercase text-muted-foreground">
          Attention
          <span className="ml-1.5 text-foreground/50 tabular-nums">
            {scope ? `${visible.length}/${queue.items.length}` : queue.items.length}
          </span>
        </h2>
        <span className="ml-auto">{worst && <AttentionSeverityBadge severity={worst} />}</span>
      </div>

      {queue.items.length > 0 && (
        <div className="flex shrink-0 items-center gap-0.5 overflow-x-auto border-b px-1.5 py-1.5 scrollbar-hide">
          <ListFilter className="mx-1 h-3 w-3 shrink-0 text-muted-foreground/60" />
          <ScopeChip label="All" active={scope === null} onClick={() => setScope(null)} />
          {ATTENTION_SCOPES.map((candidate) =>
            counts[candidate] ? (
              <ScopeChip
                key={candidate}
                label={`${ATTENTION_SCOPE_LABEL[candidate]} · ${counts[candidate]}`}
                active={scope === candidate}
                onClick={() => setScope(scope === candidate ? null : candidate)}
              />
            ) : null,
          )}
        </div>
      )}

      <div className="min-h-0 flex-1">
        {queue.loading ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : queue.error ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
            <p className="text-xs text-muted-foreground">{queue.error}</p>
            <Button variant="outline" size="sm" onClick={() => void queue.reload()}>
              Retry
            </Button>
          </div>
        ) : queue.items.length === 0 ? (
          <EmptyPanel
            icon={CheckCircle2}
            title="Nothing needs a hand"
            description="Items appear here the moment a probe needs a human."
          />
        ) : visible.length === 0 ? (
          <EmptyPanel icon={ListFilter} title="No matches" description="No item of this scope is open — widen the lens." />
        ) : (
          <ScrollArea className="h-full">
            <div className="space-y-1.5 p-1.5">
              {visible.map((item) => {
                const avatarId = item.scope === "avatar_platform" ? item.avatar_id : null;
                const known = avatarId ? avatars.some((a) => a.id === avatarId) : false;
                return (
                  <AttentionItemCard
                    key={item.id}
                    item={item}
                    target={targetOf(item)}
                    canResolve={canResolve}
                    onOpen={known && avatarId ? () => onSelectAvatar(avatarId) : undefined}
                    onAcknowledge={() => queue.acknowledge(item)}
                    onDone={() => queue.markDone(item)}
                    onResolve={() => setResolving(item)}
                  />
                );
              })}
            </div>
          </ScrollArea>
        )}
      </div>

      <AlertDialog open={resolving !== null} onOpenChange={(open) => !open && !resolvingBusy && setResolving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Resolve without a probe?</AlertDialogTitle>
            <AlertDialogDescription>
              “{resolving?.title}” closes now, on your authority. The maintainer will reopen it if the
              problem is still there.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resolvingBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void doResolve();
              }}
              disabled={resolvingBusy}
            >
              {resolvingBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Resolve
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ScopeChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "shrink-0 rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
        active ? "bg-secondary text-secondary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}
