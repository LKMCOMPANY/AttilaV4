"use client";

import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { OverviewTab } from "./tabs/overview-tab";
import { IdentityTab } from "./tabs/identity-tab";
import { PersonalityTab } from "./tabs/personality-tab";
import { ContentTab } from "./tabs/content-tab";
import type { AvatarWithRelations } from "@/types";
import { User } from "lucide-react";

export interface EditableTabProps {
  avatar: AvatarWithRelations;
  accountId: string;
  onUpdated: (avatar: AvatarWithRelations) => void;
}

interface AvatarDetailPanelProps {
  avatar: AvatarWithRelations | null;
  accountId: string;
  onAvatarUpdated: (avatar: AvatarWithRelations) => void;
}

export function AvatarDetailPanel({
  avatar,
  accountId,
  onAvatarUpdated,
}: AvatarDetailPanelProps) {
  if (!avatar) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-background">
        <div className="rounded-full bg-muted p-3">
          <User className="h-5 w-5 text-muted-foreground/40" />
        </div>
        <p className="mt-3 text-sm font-medium text-muted-foreground">
          Select an avatar
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground/60">
          Choose an avatar from the list to view details
        </p>
      </div>
    );
  }

  return (
    <div className="@container/detail flex h-full flex-col bg-background">
      <Tabs defaultValue="overview" className="flex h-full flex-col">
        <div className="flex h-10 shrink-0 items-center overflow-x-auto border-b px-3 scrollbar-hide">
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
            <TabsTrigger value="content" className="text-[11px] @[300px]/detail:text-xs">
              Content
            </TabsTrigger>
          </TabsList>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-3 @[350px]/detail:p-4">
            <TabsContent value="overview">
              <OverviewTab avatar={avatar} accountId={accountId} onUpdated={onAvatarUpdated} />
            </TabsContent>
            <TabsContent value="identity">
              <IdentityTab avatar={avatar} accountId={accountId} onUpdated={onAvatarUpdated} />
            </TabsContent>
            <TabsContent value="personality">
              <PersonalityTab avatar={avatar} accountId={accountId} onUpdated={onAvatarUpdated} />
            </TabsContent>
            <TabsContent value="content">
              <ContentTab avatar={avatar} />
            </TabsContent>
          </div>
        </ScrollArea>
      </Tabs>
    </div>
  );
}
