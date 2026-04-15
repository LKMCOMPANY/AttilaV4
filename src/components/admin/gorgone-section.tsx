"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Database, Loader2, RefreshCw, Unlink } from "lucide-react";
import { GorgoneLinkDialog } from "./gorgone-link-dialog";
import { GorgoneZoneGroup } from "./gorgone-zone-item";
import {
  getGorgoneLinks,
  unlinkGorgoneClient,
  refreshGorgoneZones,
} from "@/app/actions/gorgone";
import { toast } from "sonner";
import type { GorgoneLinkWithCursors, GorgoneSyncCursor } from "@/types";

function groupCursorsByZone(
  cursors: GorgoneSyncCursor[]
): [string, GorgoneSyncCursor[]][] {
  const map = new Map<string, GorgoneSyncCursor[]>();
  for (const cursor of cursors) {
    const group = map.get(cursor.zone_name) ?? [];
    group.push(cursor);
    map.set(cursor.zone_name, group);
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
}

interface GorgoneSectionProps {
  accountId: string;
}

export function GorgoneSection({ accountId }: GorgoneSectionProps) {
  const [links, setLinks] = useState<GorgoneLinkWithCursors[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [unlinkTarget, setUnlinkTarget] = useState<string | null>(null);
  const [refreshingLinkId, setRefreshingLinkId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const refresh = useCallback(async () => {
    try {
      const data = await getGorgoneLinks(accountId);
      setLinks(data);
    } catch {
      toast.error("Failed to load Gorgone links");
    } finally {
      setIsLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  function handleRefreshZones(linkId: string) {
    setRefreshingLinkId(linkId);
    startTransition(async () => {
      const result = await refreshGorgoneZones({ linkId });
      if (result.error) {
        toast.error(result.error);
      } else if (result.added > 0) {
        toast.success(`${result.added} new zone(s) added`);
      } else {
        toast.info("All zones already synced");
      }
      setRefreshingLinkId(null);
      refresh();
    });
  }

  function handleUnlink(linkId: string) {
    startTransition(async () => {
      const result = await unlinkGorgoneClient({ linkId });
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Client unlinked");
      }
      setUnlinkTarget(null);
      refresh();
    });
  }

  const existingClientIds = links.map((l) => l.gorgone_client_id);

  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-medium">Gorgone</h3>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading...
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-medium">Gorgone</h3>
          <Badge variant="secondary" className="text-xs">
            {links.length}
          </Badge>
        </div>
        <GorgoneLinkDialog
          accountId={accountId}
          existingClientIds={existingClientIds}
          onLinked={refresh}
        />
      </div>

      {links.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center">
          <p className="text-sm text-muted-foreground">
            No Gorgone clients linked. Link a client to start syncing
            monitoring data.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {links.map((link) => (
            <div key={link.id} className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">
                    {link.gorgone_client_name}
                  </span>
                  <Badge
                    variant={link.is_active ? "default" : "outline"}
                    className="text-[10px]"
                  >
                    {link.is_active ? "Active" : "Inactive"}
                  </Badge>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-muted-foreground"
                    onClick={() => handleRefreshZones(link.id)}
                    disabled={refreshingLinkId === link.id}
                    title="Fetch new zones from Gorgone"
                  >
                    {refreshingLinkId === link.id ? (
                      <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-1 h-3 w-3" />
                    )}
                    Refresh
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-muted-foreground hover:text-destructive"
                    onClick={() => setUnlinkTarget(link.id)}
                  >
                    <Unlink className="mr-1 h-3 w-3" />
                    Unlink
                  </Button>
                </div>
              </div>

              {link.cursors.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">
                  No zones available for sync.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {groupCursorsByZone(link.cursors).map(([zoneName, cursors]) => (
                    <GorgoneZoneGroup
                      key={zoneName}
                      zoneName={zoneName}
                      cursors={cursors}
                      onUpdated={refresh}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <AlertDialog
        open={unlinkTarget !== null}
        onOpenChange={(open) => {
          if (!open) setUnlinkTarget(null);
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Unlink Gorgone Client</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the link and all sync cursors for this client.
              Already synced data will be preserved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => unlinkTarget && handleUnlink(unlinkTarget)}
            >
              Unlink
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
