"use client";

import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { Ban, CheckCheck, Loader2, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SocialIcon } from "@/components/icons/social-icons";
import { AccountHealthBadge } from "@/components/shared/account-health-badge";
import {
  ACCOUNT_HEALTH_META,
  blockReasonToKind,
} from "@/lib/constants/account-health";
import { PLATFORM_LIST } from "@/lib/constants/avatar";
import {
  blockAvatarPlatform,
  resolveAvatarPlatformBlock,
} from "@/app/actions/avatar-blocks";
import type {
  AvatarPlatformBlock,
  AvatarWithRelations,
  SocialPlatform,
} from "@/types";

// ---------------------------------------------------------------------------
// Automation guardrail — the avatar's per-platform callability.
//
// One card per ACTIVE block (from `avatar_platform_blocks`): why the Automator
// skips this avatar, since when, from which evidence — and the "Mark resolved"
// action that clears the block once the operator fixed the account, making the
// avatar selectable again. No block = a quiet "callable" line. The operator can
// also block an enabled platform by hand (account under review, handover…).
// ---------------------------------------------------------------------------

const SOURCE_LABELS: Record<AvatarPlatformBlock["source"], string> = {
  on_device: "seen on device",
  tikhub: "TikHub check",
  verification: "post verification",
  operator: "manual block",
};

interface AccountStateSectionProps {
  avatar: AvatarWithRelations;
  blocks: AvatarPlatformBlock[];
  onResolved: (avatarId: string, platform: SocialPlatform) => void;
  onBlocked: (avatarId: string, block: AvatarPlatformBlock) => void;
}

export function AccountStateSection({
  avatar,
  blocks,
  onResolved,
  onBlocked,
}: AccountStateSectionProps) {
  const [confirming, setConfirming] = useState<AvatarPlatformBlock | null>(null);
  const [resolving, setResolving] = useState(false);
  const [blocking, setBlocking] = useState(false);

  // Platforms the operator can still pull from rotation by hand.
  const blockablePlatforms = PLATFORM_LIST.filter(
    (p) => avatar[p.enabledKey] && !blocks.some((b) => b.platform === p.id),
  );

  const confirmingLabel = confirming ? platformLabel(confirming.platform) : "";

  const doResolve = async () => {
    if (!confirming) return;
    setResolving(true);
    try {
      const { error } = await resolveAvatarPlatformBlock(avatar.id, confirming.platform);
      if (error) {
        toast.error(error);
        return;
      }
      toast.success(`${confirmingLabel} unblocked — callable by the Automator again`);
      onResolved(avatar.id, confirming.platform);
      setConfirming(null);
    } catch {
      toast.error("Failed to resolve the block");
    } finally {
      setResolving(false);
    }
  };

  const doBlock = async (platform: SocialPlatform) => {
    setBlocking(true);
    try {
      const { error } = await blockAvatarPlatform(avatar.id, platform);
      if (error) {
        toast.error(error);
        return;
      }
      toast.success(`${platformLabel(platform)} blocked — the Automator will skip it`);
      // Optimistic row; the next realtime tick replaces it with the DB truth.
      onBlocked(avatar.id, {
        id: crypto.randomUUID(),
        platform,
        reason: "manual",
        source: "operator",
        detail: "Blocked manually by an operator",
        first_detected_at: new Date().toISOString(),
      });
    } catch {
      toast.error("Failed to block the platform");
    } finally {
      setBlocking(false);
    }
  };

  return (
    <>
      <div className="space-y-1.5">
        {blocks.length === 0 ? (
          <div className="flex items-center gap-2 rounded-lg border border-dashed bg-muted/20 px-3 py-2">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-success" />
            <p className="flex-1 text-[12px] text-muted-foreground">
              Callable by the Automator — no active block.
            </p>
            <BlockMenu
              platforms={blockablePlatforms}
              blocking={blocking}
              onBlock={doBlock}
            />
          </div>
        ) : (
          <>
            {blocks.map((block) => (
              <BlockCard key={block.id} block={block} onResolve={() => setConfirming(block)} />
            ))}
            {blockablePlatforms.length > 0 && (
              <div className="flex justify-end">
                <BlockMenu
                  platforms={blockablePlatforms}
                  blocking={blocking}
                  onBlock={doBlock}
                />
              </div>
            )}
          </>
        )}
      </div>

      <AlertDialog
        open={confirming !== null}
        onOpenChange={(open) => !open && !resolving && setConfirming(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark {confirmingLabel} as resolved?</AlertDialogTitle>
            <AlertDialogDescription>
              This clears the “
              {confirming ? ACCOUNT_HEALTH_META[blockReasonToKind(confirming.reason)].label : ""}
              ” block and makes {avatar.first_name} {avatar.last_name} callable by the
              Automator on {confirmingLabel} again. Do this only after fixing the account
              (logged back in, captcha cleared, appeal accepted…). If the problem persists,
              the next run will block it again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resolving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                doResolve();
              }}
              disabled={resolving}
            >
              {resolving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Mark resolved
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** Manual block: pick an enabled, unblocked platform to pull from rotation. */
function BlockMenu({
  platforms,
  blocking,
  onBlock,
}: {
  platforms: typeof PLATFORM_LIST;
  blocking: boolean;
  onBlock: (platform: SocialPlatform) => void;
}) {
  if (platforms.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            disabled={blocking}
            className="h-6 shrink-0 gap-1 px-1.5 text-[10px] text-muted-foreground hover:text-destructive"
          />
        }
      >
        {blocking ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Ban className="h-3 w-3" />
        )}
        Block
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {platforms.map((p) => (
          <DropdownMenuItem key={p.id} onClick={() => onBlock(p.id)}>
            <SocialIcon platform={p.id} className={cn("size-3.5", p.color)} />
            {p.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function BlockCard({
  block,
  onResolve,
}: {
  block: AvatarPlatformBlock;
  onResolve: () => void;
}) {
  const kind = blockReasonToKind(block.reason);
  const tone = ACCOUNT_HEALTH_META[kind].tone;
  const platform = PLATFORM_LIST.find((p) => p.id === block.platform);

  return (
    <div
      className={cn(
        "rounded-lg border p-2.5",
        tone === "critical"
          ? "border-destructive/25 bg-destructive/4"
          : "border-warning/30 bg-warning/4",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {platform && (
              <span
                className={cn(
                  "inline-flex h-[18px] items-center gap-1 rounded px-1.5",
                  platform.bgColor,
                  platform.color,
                )}
              >
                <SocialIcon platform={platform.id} className="h-2.5 w-2.5" />
                <span className="text-[10px] font-medium">{platform.abbr}</span>
              </span>
            )}
            <AccountHealthBadge kind={kind} />
            <span className="text-[10px] text-muted-foreground">
              {SOURCE_LABELS[block.source]} ·{" "}
              {formatDistanceToNow(new Date(block.first_detected_at), { addSuffix: true })}
            </span>
          </div>
          {block.detail && (
            <p className="line-clamp-2 text-[11px] text-muted-foreground" title={block.detail}>
              {block.detail}
            </p>
          )}
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={onResolve}
          className="h-7 shrink-0 gap-1 px-2 text-[11px]"
        >
          <CheckCheck className="h-3 w-3" />
          Mark resolved
        </Button>
      </div>
    </div>
  );
}

function platformLabel(platform: SocialPlatform): string {
  return PLATFORM_LIST.find((p) => p.id === platform)?.label ?? platform;
}
