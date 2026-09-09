"use client";

import { useCallback, useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Activity, Loader2, RefreshCw, Stethoscope } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { OnDeviceBadge } from "@/components/shared/maintenance-badge";
import { SocialIcon } from "@/components/icons/social-icons";
import {
  cancelMaintenanceTask,
  getAvatarMaintenance,
  requestMaintenanceTaskNow,
  setAvatarMaintenance,
} from "@/app/actions/maintenance";
import type { AvatarMaintenanceOverview } from "@/lib/operator/maintenance";
import { PLATFORM_LIST } from "@/lib/constants/avatar";
import { PROFILE_LABEL } from "@/lib/presentation/maintenance";
import { Section } from "./device-info";
import { MaintenanceTaskList } from "./maintenance-task-list";
import type { AvatarWithRelations, MaintenanceProfile, SocialPlatform } from "@/types";

/** Poll cadence while a task runs — the journal moves step by step. */
const RUNNING_POLL_MS = 15_000;

/**
 * Maintenance: the switch and the maturation profile of this avatar, what the
 * device last showed per platform, and the tasks the maintainer ran or plans
 * — each with its step journal and proofs. Managers and admins flip the
 * switch; every member may ask for a probe now.
 */
export function MaintenanceTab({ avatar, canManage }: { avatar: AvatarWithRelations; canManage: boolean }) {
  const [overview, setOverview] = useState<AvatarMaintenanceOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const result = await getAvatarMaintenance(avatar.id);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setError(null);
    setOverview(result);
  }, [avatar.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const running = overview?.tasks.some((t) => t.status === "running") ?? false;
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => void load(), RUNNING_POLL_MS);
    return () => clearInterval(timer);
  }, [running, load]);

  const patch = async (input: Parameters<typeof setAvatarMaintenance>[1]) => {
    setBusy(true);
    try {
      const result = await setAvatarMaintenance(avatar.id, input);
      if ("error" in result) toast.error(result.error);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const probeNow = async (platform: SocialPlatform) => {
    const result = await requestMaintenanceTaskNow(avatar.id, { kind: "probe", platform });
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    toast.success("Probe queued — it runs on the next free slot");
    await load();
  };

  const cancel = async (taskId: string) => {
    const result = await cancelMaintenanceTask(taskId);
    if ("error" in result) toast.error(result.error);
    await load();
  };

  const enabledPlatforms = PLATFORM_LIST.filter((p) => avatar[p.enabledKey] && (p.id === "tiktok" || p.id === "twitter"));

  return (
    <div className="space-y-3">
      <Section
        title="Maintenance"
        icon={Activity}
        action={
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => void load()} title="Refresh">
            <RefreshCw className="h-3 w-3" />
          </Button>
        }
      >
        {error && <p className="py-1.5 text-[11px] text-destructive">{error}</p>}
        {!overview && !error && (
          <div className="flex items-center gap-2 py-1.5 text-[11px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Reading…
          </div>
        )}
        {overview && (
          <>
            <div className="flex items-center justify-between gap-3 py-1.5">
              <div>
                <p className="text-[11px] font-medium">Maintained by the AI operator</p>
                <p className="text-[10px] text-muted-foreground">
                  Daily probe, passive sessions in the persona&apos;s hours, escalation to the attention queue.
                </p>
              </div>
              <Switch
                checked={overview.enabled}
                disabled={!canManage || busy}
                onCheckedChange={(checked) => void patch({ enabled: checked })}
                aria-label="Maintenance enabled"
              />
            </div>
            <div className="flex items-center justify-between gap-3 py-1.5">
              <span className="text-[11px] text-muted-foreground">Profile</span>
              <NativeSelect
                size="sm"
                value={overview.profile}
                disabled={!canManage || busy}
                onChange={(e) => void patch({ profile: e.target.value as MaintenanceProfile })}
              >
                {(Object.keys(PROFILE_LABEL) as MaintenanceProfile[]).map((profile) => (
                  <NativeSelectOption key={profile} value={profile}>
                    {PROFILE_LABEL[profile]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <div className="flex items-center justify-between gap-3 py-1.5">
              <span className="text-[11px] text-muted-foreground" title="The first day of the account's life on this device — drives the maturation curve">
                Day zero
              </span>
              <Input
                type="date"
                className="h-7 w-[150px] text-[11px]"
                value={overview.dayZero ?? ""}
                disabled={!canManage || busy}
                onChange={(e) => void patch({ dayZero: e.target.value || null })}
              />
            </div>
          </>
        )}
      </Section>

      {overview && (
        <Section title="On the device" icon={Stethoscope}>
          {enabledPlatforms.length === 0 && (
            <p className="py-1.5 text-[11px] text-muted-foreground">No TikTok or X account enabled — nothing to maintain yet.</p>
          )}
          {enabledPlatforms.map((platform) => {
            const state = overview.states.find((s) => s.platform === platform.id) ?? null;
            return (
              <div key={platform.id} className="flex items-center justify-between gap-2 py-1.5">
                <div className="flex min-w-0 items-center gap-2">
                  <SocialIcon platform={platform.id} className={`h-3.5 w-3.5 ${platform.color}`} />
                  <span className="text-[11px] font-medium">{platform.label}</span>
                  {state ? (
                    <OnDeviceBadge state={state} showOk />
                  ) : (
                    <span className="text-[10px] text-muted-foreground">never probed</span>
                  )}
                  {state?.probed_at && (
                    <span className="text-[10px] text-muted-foreground">
                      {formatDistanceToNow(new Date(state.probed_at), { addSuffix: true })}
                      {state.last_session_at && ` · last session ${formatDistanceToNow(new Date(state.last_session_at), { addSuffix: true })}`}
                    </span>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 gap-1 px-1.5 text-[10px]"
                  disabled={!avatar.device}
                  title={avatar.device ? "Queue a probe now" : "Attach a device first"}
                  onClick={() => void probeNow(platform.id)}
                >
                  <Stethoscope className="h-3 w-3" /> Probe now
                </Button>
              </div>
            );
          })}
        </Section>
      )}

      {overview && <MaintenanceTaskList tasks={overview.tasks} onCancel={cancel} />}
    </div>
  );
}
