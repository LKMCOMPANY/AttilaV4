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
import { Database, Loader2, Unlink, Zap } from "lucide-react";
import { GorgoneLinkDialog } from "./gorgone-link-dialog";
import { GorgoneZoneGroup } from "./gorgone-zone-item";
import { GorgoneWebhookConfig } from "./gorgone-webhook-config";
import {
  getGorgoneLinks,
  unlinkGorgoneAccount,
  runSweepNow,
} from "@/app/actions/gorgone";
import { toast } from "sonner";
import type { GorgoneLinkWithZones, GorgoneZoneRow } from "@/types";

function groupZonesByName(
  rows: GorgoneZoneRow[],
): [string, GorgoneZoneRow[]][] {
  const map = new Map<string, GorgoneZoneRow[]>();
  for (const row of rows) {
    const group = map.get(row.zone_name) ?? [];
    group.push(row);
    map.set(row.zone_name, group);
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
}

interface GorgoneSectionProps {
  accountId: string;
}

export function GorgoneSection({ accountId }: GorgoneSectionProps) {
  const [links, setLinks] = useState<GorgoneLinkWithZones[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [unlinkTarget, setUnlinkTarget] = useState<string | null>(null);
  const [isSweeping, startSweepTransition] = useTransition();
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

  function handleUnlink(linkId: string) {
    startTransition(async () => {
      const result = await unlinkGorgoneAccount({ linkId });
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Account unlinked");
      }
      setUnlinkTarget(null);
      refresh();
    });
  }

  function handleSweepNow() {
    startSweepTransition(async () => {
      const report = await runSweepNow();
      if (report.error) {
        toast.error(report.error);
      } else {
        toast.success(
          `Sweep done: ${report.total_enqueued} enqueued across ${report.zones_with_data} zone(s) in ${report.duration_ms}ms`,
        );
      }
      refresh();
    });
  }

  const existingAccountIds = links
    .map((l) => l.gorgone_account_id ?? l.gorgone_client_id)
    .filter((id): id is string => Boolean(id));

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
        <div className="flex items-center gap-2">
          {links.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-muted-foreground"
              onClick={handleSweepNow}
              disabled={isSweeping}
              title="Run reconciliation sweep across all linked zones"
            >
              {isSweeping ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : (
                <Zap className="mr-1 h-3 w-3" />
              )}
              Sweep
            </Button>
          )}
          <GorgoneLinkDialog
            accountId={accountId}
            existingAccountIds={existingAccountIds}
            onLinked={refresh}
          />
        </div>
      </div>

      {links.length > 0 && <GorgoneWebhookConfig />}

      {links.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center">
          <p className="text-sm text-muted-foreground">
            No Gorgone account linked. Link an account to receive monitoring data.
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
                    className="h-7 text-xs text-muted-foreground hover:text-destructive"
                    onClick={() => setUnlinkTarget(link.id)}
                  >
                    <Unlink className="mr-1 h-3 w-3" />
                    Unlink
                  </Button>
                </div>
              </div>

              {link.zones.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">
                  No zones available for this account. Create a zone in Gorgone to start.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {groupZonesByName(link.zones).map(([zoneName, rows]) => (
                    <GorgoneZoneGroup
                      key={zoneName}
                      zoneName={zoneName}
                      rows={rows}
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
            <AlertDialogTitle>Unlink Gorgone Account</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the Attila ↔ Gorgone link. Subscriptions on Gorgone
              are <strong>not</strong> reset and need to be turned off
              manually if you want to fully detach. Already-ingested jobs are
              preserved.
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
