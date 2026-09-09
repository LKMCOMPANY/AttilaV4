"use client";

import { useEffect, useState } from "react";
import { Loader2, Sparkles, Target } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { compileArmyBrief, getArmyBrief, setArmyBrief } from "@/app/actions/briefs";

/**
 * The army's cluster objective ("sit in French football, back Mbappé") and its
 * keywords, edited by managers and admins next to the army's name; "Compile"
 * recomputes the effective brief of every avatar of the army.
 */
export function ArmyBriefPopover({ armyId, armyName, canManage }: { armyId: string; armyName: string; canManage: boolean }) {
  const [open, setOpen] = useState(false);
  const [objective, setObjective] = useState("");
  const [keywords, setKeywords] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [compiling, setCompiling] = useState(false);

  useEffect(() => {
    if (!open || loaded) return;
    let cancelled = false;
    getArmyBrief(armyId).then((result) => {
      if (cancelled || "error" in result) return;
      setObjective(result.brief?.objective ?? "");
      setKeywords((result.brief?.cluster_keywords ?? []).join(", "));
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [open, loaded, armyId]);

  const save = async () => {
    setSaving(true);
    try {
      const result = await setArmyBrief(armyId, {
        objective,
        clusterKeywords: keywords.split(",").map((k) => k.trim()).filter(Boolean),
      });
      if ("error" in result) toast.error(result.error);
      else toast.success(`Objective of ${armyName} saved`);
    } finally {
      setSaving(false);
    }
  };

  const compile = async () => {
    setCompiling(true);
    try {
      const result = await compileArmyBrief(armyId);
      if ("error" in result) toast.error(result.error);
      else toast.success(`${result.compiled} brief${result.compiled !== 1 ? "s" : ""} compiled${result.failed ? `, ${result.failed} failed` : ""}`);
    } finally {
      setCompiling(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
            title={`Objective of ${armyName}`}
            aria-label={`Objective of ${armyName}`}
          >
            <Target className="h-3 w-3" />
          </button>
        }
      />
      <PopoverContent align="start" className="w-80 space-y-2 p-3">
        <div>
          <p className="text-[11px] font-semibold">{armyName} — cluster objective</p>
          <p className="text-[10px] text-muted-foreground">What the avatars of this army are for. Compiled into each avatar&apos;s effective brief.</p>
        </div>
        {!loaded ? (
          <div className="flex items-center gap-2 py-2 text-[11px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Reading…
          </div>
        ) : (
          <>
            <Textarea
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              placeholder="Ex.: se clusteriser dans le football français, soutenir Mbappé, éviter la politique."
              className="min-h-[80px] text-[11px]"
              disabled={!canManage}
              maxLength={2000}
            />
            <Input
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              placeholder="Cluster keywords, comma-separated (Ligue 1, PSG, Mbappé)"
              className="h-7 text-[11px]"
              disabled={!canManage}
            />
            {canManage && (
              <div className="flex items-center justify-end gap-1.5">
                <Button variant="ghost" size="sm" className="h-7 gap-1 text-[11px]" disabled={compiling} onClick={() => void compile()}>
                  {compiling ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                  Compile briefs
                </Button>
                <Button size="sm" className="h-7 text-[11px]" disabled={saving} onClick={() => void save()}>
                  {saving && <Loader2 className="h-3 w-3 animate-spin" />}
                  Save
                </Button>
              </div>
            )}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
