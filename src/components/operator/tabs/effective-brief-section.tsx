"use client";

import { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { AlertTriangle, Loader2, ScrollText, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { compileAvatarBrief } from "@/app/actions/briefs";
import { getAvatarMaintenance } from "@/app/actions/maintenance";
import type { AvatarBrief } from "@/types";

/**
 * The effective brief: persona and army objectives compiled into one page by
 * Aleria, with the contradictions listed rather than hidden. Read from the
 * maintenance overview (same round-trip as the tab), recompiled on demand.
 */
export function EffectiveBriefSection({ avatarId }: { avatarId: string }) {
  const [brief, setBrief] = useState<AvatarBrief | null | undefined>(undefined);
  const [compiling, setCompiling] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getAvatarMaintenance(avatarId).then((result) => {
      if (!cancelled) setBrief("error" in result ? null : result.brief);
    });
    return () => {
      cancelled = true;
    };
  }, [avatarId]);

  const compile = async () => {
    setCompiling(true);
    try {
      const result = await compileAvatarBrief(avatarId);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setBrief(result.brief);
      toast.success("Brief compiled");
    } finally {
      setCompiling(false);
    }
  };

  return (
    <div className="rounded-lg border bg-card/50 px-3 py-2.5">
      <div className="mb-1.5 flex items-center gap-1.5">
        <ScrollText className="h-3 w-3 text-muted-foreground/60" />
        <h4 className="text-[10px] font-semibold tracking-widest uppercase text-muted-foreground">Effective brief</h4>
        <Button variant="ghost" size="sm" className="ml-auto h-6 gap-1 px-1.5 text-[10px]" disabled={compiling} onClick={() => void compile()}>
          {compiling ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
          {brief ? "Recompile" : "Compile"}
        </Button>
      </div>
      {brief === undefined && (
        <div className="flex items-center gap-2 py-1 text-[11px] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Reading…
        </div>
      )}
      {brief === null && (
        <p className="py-1 text-[11px] text-muted-foreground">
          Not compiled yet. The brief merges this persona with the objectives of its armies; compile it once the armies carry one.
        </p>
      )}
      {brief && (
        <div className="space-y-2">
          <p className="whitespace-pre-wrap text-[11px] leading-relaxed">{brief.effective_brief}</p>
          {brief.contradictions.length > 0 && (
            <ul className="space-y-1 rounded-md border border-warning/30 bg-warning/5 p-2">
              {brief.contradictions.map((c, index) => (
                <li key={index} className="flex items-start gap-1.5 text-[10px]">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-warning" />
                  <span>
                    <span className="font-medium">{c.between}</span> — {c.detail}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {brief.compiled_at && (
            <p className="text-[10px] text-muted-foreground">Compiled {formatDistanceToNow(new Date(brief.compiled_at), { addSuffix: true })}</p>
          )}
        </div>
      )}
    </div>
  );
}
