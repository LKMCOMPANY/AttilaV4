"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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
import { OverviewTab } from "./tabs/overview-tab";
import { IdentityTab } from "./tabs/identity-tab";
import { PersonalityTab } from "./tabs/personality-tab";
import { DeviceTab } from "./tabs/device-tab";
import { ContentTab } from "./tabs/content-tab";
import { EmptyPanel } from "@/components/ui/empty";
import { archiveAvatar } from "@/app/actions/avatars";
import type { AvatarHealthSignals } from "@/lib/constants/account-health";
import type { AvatarWithRelations } from "@/types";
import { User, Archive, Loader2 } from "lucide-react";

export interface EditableTabProps {
  avatar: AvatarWithRelations;
  accountId: string;
  onUpdated: (avatar: AvatarWithRelations) => void;
  /** On-device / shadow-ban signals for this avatar (operator health). */
  healthSignals?: AvatarHealthSignals;
}

interface AvatarDetailPanelProps {
  avatar: AvatarWithRelations | null;
  accountId: string;
  canManage: boolean;
  healthSignals?: AvatarHealthSignals;
  onAvatarUpdated: (avatar: AvatarWithRelations) => void;
  onAvatarArchived: (avatarId: string) => void;
}

export function AvatarDetailPanel({
  avatar,
  accountId,
  canManage,
  healthSignals,
  onAvatarUpdated,
  onAvatarArchived,
}: AvatarDetailPanelProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [archiving, setArchiving] = useState(false);

  if (!avatar) {
    return (
      <EmptyPanel
        icon={User}
        title="Select an avatar"
        description="Choose an avatar from the list to view details"
      />
    );
  }

  const doArchive = async () => {
    setArchiving(true);
    try {
      const result = await archiveAvatar(avatar.id);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setConfirmOpen(false);
      onAvatarArchived(avatar.id);
      toast.success("Avatar archived — device freed");
    } catch {
      toast.error("Failed to archive avatar");
    } finally {
      setArchiving(false);
    }
  };

  return (
    <div className="@container/detail flex h-full flex-col bg-background">
      <Tabs defaultValue="overview" className="flex min-h-0 h-full flex-col">
        <div className="flex h-10 shrink-0 items-center gap-2 overflow-x-auto border-b px-3 scrollbar-hide">
          <TabsList variant="line">
            <TabsTrigger value="overview" className="text-[11px] @[300px]/detail:text-xs">
              Overview
            </TabsTrigger>
            <TabsTrigger value="identity" className="text-[11px] @[300px]/detail:text-xs">
              Identity
            </TabsTrigger>
            <TabsTrigger value="personality" className="text-[11px] @[300px]/detail:text-xs">
              Personality
            </TabsTrigger>
            <TabsTrigger value="device" className="text-[11px] @[300px]/detail:text-xs">
              Device
            </TabsTrigger>
            <TabsTrigger value="content" className="text-[11px] @[300px]/detail:text-xs">
              Content
            </TabsTrigger>
          </TabsList>

          {canManage && (
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto h-7 shrink-0 gap-1 px-2 text-[10px] text-muted-foreground hover:text-destructive"
              onClick={() => setConfirmOpen(true)}
            >
              <Archive className="h-3 w-3" /> Archive
            </Button>
          )}
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div className="p-3 @[350px]/detail:p-4">
            <TabsContent value="overview">
              <OverviewTab
                avatar={avatar}
                accountId={accountId}
                onUpdated={onAvatarUpdated}
                healthSignals={healthSignals}
              />
            </TabsContent>
            <TabsContent value="identity">
              <IdentityTab avatar={avatar} accountId={accountId} onUpdated={onAvatarUpdated} />
            </TabsContent>
            <TabsContent value="personality">
              <PersonalityTab avatar={avatar} accountId={accountId} onUpdated={onAvatarUpdated} />
            </TabsContent>
            <TabsContent value="device">
              <DeviceTab avatar={avatar} accountId={accountId} onUpdated={onAvatarUpdated} />
            </TabsContent>
            <TabsContent value="content">
              <ContentTab avatar={avatar} />
            </TabsContent>
          </div>
        </ScrollArea>
      </Tabs>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Archive {avatar.first_name} {avatar.last_name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The avatar is hidden from the active list, its device is detached and freed for reuse,
              and its queued automation jobs are cancelled. History and credentials are kept — you can
              restore it later from &quot;Archived&quot;.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={archiving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                doArchive();
              }}
              disabled={archiving}
            >
              {archiving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
