"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getMaintenanceReport } from "@/app/actions/maintenance";
import type { MaintenanceReport } from "@/lib/maintenance/report";
import { ON_DEVICE_STATUS_META, TOO_REGULAR_THRESHOLD_LABEL } from "@/lib/presentation/maintenance";

/**
 * The maintainer's weekly report for the account: per maintained avatar, what
 * ran and what it did, the escalations, and the self-audit — sessions that
 * start at the same minute every day read like a cron job.
 */
export function MaintenanceReportDialog({ accountId, open, onOpenChange }: { accountId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [report, setReport] = useState<MaintenanceReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getMaintenanceReport(accountId, 7).then((result) => {
      if (cancelled) return;
      if ("error" in result) setError(result.error);
      else setReport(result);
    });
    return () => {
      cancelled = true;
    };
  }, [open, accountId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-sm">Maintenance — last 7 days</DialogTitle>
          <DialogDescription className="text-[11px]">
            {report
              ? `${report.totals.sessions} sessions · ${report.totals.likes} likes · ${report.totals.follows} follows · ${report.totals.logins} re-logins · ${report.totals.attention_opened} escalations · ${report.totals.failed_tasks} failed tasks`
              : "What the AI operator did for the maintained avatars."}
          </DialogDescription>
        </DialogHeader>
        {error && <p className="text-xs text-destructive">{error}</p>}
        {!report && !error && (
          <div className="flex h-24 items-center justify-center text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        )}
        {report && report.too_regular.length > 0 && (
          <p className="flex items-start gap-1.5 rounded-md border border-warning/30 bg-warning/5 p-2 text-[11px]">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-warning" />
            Sessions too regular ({TOO_REGULAR_THRESHOLD_LABEL}): {report.too_regular.join(", ")} — a detector would see a clock. Check the jitter of the planner.
          </p>
        )}
        {report && report.avatars.length === 0 && <p className="text-xs text-muted-foreground">No maintained avatar this week.</p>}
        {report && report.avatars.length > 0 && (
          <div className="max-h-[55vh] overflow-auto rounded-md border">
            <table className="w-full text-[11px]">
              <thead className="sticky top-0 bg-muted/60 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5">Avatar</th>
                  <th className="px-2 py-1.5">On device</th>
                  <th className="px-2 py-1.5 text-right">Sessions</th>
                  <th className="px-2 py-1.5 text-right">Likes</th>
                  <th className="px-2 py-1.5 text-right">Follows</th>
                  <th className="px-2 py-1.5 text-right">Cluster</th>
                  <th className="px-2 py-1.5 text-right">Escalations</th>
                  <th className="px-2 py-1.5 text-right">Failed</th>
                  <th className="px-2 py-1.5 text-right" title="Spread of session start times (0 = a clock, 1 = spread across the day)">Spread</th>
                </tr>
              </thead>
              <tbody>
                {report.avatars.map((row) => (
                  <tr key={row.avatar_id} className="border-t">
                    <td className="px-2 py-1.5 font-medium">{row.name}</td>
                    <td className="px-2 py-1.5 text-muted-foreground">{row.on_device_status ? ON_DEVICE_STATUS_META[row.on_device_status].label : "—"}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{row.sessions}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{row.likes}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{row.follows}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {row.candidates.followed}/{row.candidates.total}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{row.attention_opened}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{row.tasks.failed ?? 0}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{row.regularity_spread === null ? "—" : row.regularity_spread.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
